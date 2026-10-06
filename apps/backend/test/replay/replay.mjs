#!/usr/bin/env node
// 录制重放全链路测试（characterization test）。
//
// 把一次生产 brief run 在本地原样重跑：backend workflow + ai-worker 的代码全是真的，
// 唯一被替换的是 LLM provider 边界——ai-worker 的 Workers AI binding `env.AI` 换成
// replay-ai-worker.js，DashScope 的地址（DASHSCOPE_BASE_URL）指到 runner 的本地服务，chat 调用都从录像作答；
// 句子向量不在录像里，从本地向量缓存作答，缓存没有的批次现调一次真模型（vector-cache.mjs）。
// 跑完把产出与生产那次的产出逐字段比对。
//
// 用法：
//   node replay.mjs <workflowId>            全链路重放 + 比对
//   node replay.mjs <workflowId> --slice    纵向切片：只重放一条 cluster_judge 调用
//   选项：--fetch 强制重拉录像；--keep 跑完不关 wrangler/ml-service（调试用）；
//         --no-fail-fast 出现 miss 后仍跑到底（默认首个 miss 即收尾）；
//         --skip-seed 不播种 R2（假通过守卫的自检，预期 FAIL）
//
// 退出码：0 = 零 miss 且产出与生产一致；1 = 有 miss / 有差异 / 假通过守卫触发；2 = 用法或环境错误。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  HERE, BACKEND_DIR, AI_WORKER_DIR, ML_DIR, WRANGLER, CF_ACCOUNT_ID,
  credentials, pg, parseJsonc, runDir, resolveLocalOnly, mapLimit, unifiedDiff,
} from './lib.mjs';
import { fetchRecording } from './fetch-recording.mjs';
import { ReplayStore, startReplayServer, aiWorkerReplayEnv } from './replay-server.mjs';
import { VectorCache } from './vector-cache.mjs';

const args = process.argv.slice(2);
const wf = args.find((a) => !a.startsWith('--'));
const SLICE = args.includes('--slice');
const KEEP = args.includes('--keep');
// 默认第一次 miss 就收尾：之后的产出必然偏离，继续跑只是烧时间。--no-fail-fast 跑到底看全部 miss。
const FAIL_FAST = !args.includes('--no-fail-fast');
// 守卫自检：不播种 R2，workflow 取不到正文、到不了 LLM 段——测试必须判 FAIL。
const SKIP_SEED = args.includes('--skip-seed');
if (!wf) {
  console.error('用法: pnpm -F @meridian/backend replay <workflowId> [--slice] [--fetch] [--keep] [--no-fail-fast] [--skip-seed]');
  process.exit(2);
}

const t0 = Date.now();
const dir = runDir(wf);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(dir, 'out', stamp + (SLICE ? '-slice' : ''));
const genDir = path.join(outDir, 'gen');
fs.mkdirSync(genDir, { recursive: true });
const log = (...a) => console.log(`[replay +${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const children = [];

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

// ── 生成重放用 wrangler 配置（只在 data/ 下，不动仓库里的配置） ─────────────
function writeConfig(name, config, devVars) {
  const d = path.join(genDir, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'wrangler.json'), JSON.stringify(config, null, 2));
  // .dev.vars 从 config 所在目录读。这里只放重放需要的值，**不含任何真实密钥**：
  // ai-worker 的两条模型通道都已改道——AI binding 指向替身，DashScope 的地址指向 runner 的本地服务、
  // key 是占位值——不可能绕过去打真模型。
  fs.writeFileSync(path.join(d, '.dev.vars'), Object.entries(devVars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  return path.join(d, 'wrangler.json');
}

const BUCKET = 'meridian-replay-articles'; // 本地模拟桶；名字刻意与生产不同

function generateConfigs({ store, replayPort, mlPort, apiToken }) {
  // backend：从仓库里的 wrangler.jsonc 派生，只改三处外部依赖
  const be = parseJsonc(fs.readFileSync(path.join(BACKEND_DIR, 'wrangler.jsonc'), 'utf8'));
  delete be.$schema;
  be.main = path.join(BACKEND_DIR, be.main);
  delete be.triggers; // 不让本地 cron 自己起一期
  be.r2_buckets = be.r2_buckets.map((b) => ({ binding: b.binding, bucket_name: BUCKET })); // 去掉 remote:true
  // Browser Run 只有 remote 一种接法；简报 workflow 不抓正文、用不到它，留着会让 wrangler dev 启动时去连远端
  delete be.browser;
  // CF_ANALYTICS_TOKEN 是 wrangler 配置里声明必填的 secret（运维台读账户用量）；重放不走运维台，给个占位值
  const bePath = writeConfig('backend', be, { API_TOKEN: apiToken, CF_ANALYTICS_TOKEN: 'replay-not-used' });

  // ml：backend 的 ML_SERVICE binding 按 Worker 名指向 meridian-ml-service；本地由 dev-shim 顶替，转发到本地 uvicorn
  const shimDir = path.join(ML_DIR, 'dev-shim');
  const shim = parseJsonc(fs.readFileSync(path.join(shimDir, 'wrangler.jsonc'), 'utf8'));
  if (!be.services?.some((s) => s.binding === 'ML_SERVICE' && s.service === shim.name)) {
    throw new Error(`backend wrangler.jsonc 的 ML_SERVICE binding 不再指向 ${shim.name}，更新重放配置`);
  }
  shim.main = path.join(shimDir, shim.main);
  shim.vars = { ...shim.vars, ML_LOCAL_URL: `http://127.0.0.1:${mlPort}` };
  const mlPath = writeConfig('ml-shim', shim, {});

  // ai-worker：wrangler.toml 很小，照抄其形状；唯一的实质改动是 AI binding → 替身
  const toml = fs.readFileSync(path.join(AI_WORKER_DIR, 'wrangler.toml'), 'utf8');
  const compat = toml.match(/^compatibility_date\s*=\s*"([^"]+)"/m)[1];
  const flags = JSON.parse(toml.match(/^compatibility_flags\s*=\s*(\[.*\])/m)[1]);
  if (!/^\[ai\]\s*\nbinding\s*=\s*"AI"/m.test(toml)) throw new Error('ai-worker wrangler.toml 的 [ai] binding 形状变了，更新重放配置');
  const aiEnv = aiWorkerReplayEnv(store, replayPort);
  const aw = {
    name: 'meridian-ai-worker',
    main: path.join(AI_WORKER_DIR, 'src/index.ts'),
    compatibility_date: compat,
    compatibility_flags: flags,
    services: [{ binding: 'AI', service: 'meridian-replay-ai', entrypoint: 'ReplayAI' }],
    r2_buckets: [{ binding: 'ARTICLES_BUCKET', bucket_name: BUCKET }],
    // 第二条模型通道 DashScope 走 HTTP，不经 AI binding：把它的地址也指到 runner 的本地服务
    vars: aiEnv.vars,
  };
  const awPath = writeConfig('ai-worker', aw, aiEnv.devVars);

  const ra = {
    name: 'meridian-replay-ai',
    main: path.join(HERE, 'replay-ai-worker.js'),
    compatibility_date: '2025-04-30',
    services: [
      { binding: 'BACKEND', service: 'meridian-backend' },
      { binding: 'AIW', service: 'meridian-ai-worker' },
    ],
    r2_buckets: [{ binding: 'ARTICLES_BUCKET', bucket_name: BUCKET }],
    vars: { REPLAY_SERVER: `http://127.0.0.1:${replayPort}` },
  };
  const raPath = writeConfig('replay-ai', ra, {});
  // 第一个 -c 是唯一暴露 HTTP 的（primary）；替身排第一，其余请求它转给 backend
  return [raPath, bePath, awPath, mlPath];
}

// ── 子进程 ────────────────────────────────────────────────────────────────
function spawnLogged(name, cmd, argv, opts) {
  const logFile = path.join(outDir, `${name}.log`);
  const fd = fs.openSync(logFile, 'a');
  const p = spawn(cmd, argv, { ...opts, stdio: ['ignore', fd, fd], detached: true });
  children.push(p);
  p.on('exit', (code) => { if (!p.__stopping) log(`${name} 退出 code=${code}（日志 ${logFile}）`); });
  return { p, logFile };
}

function stopAll() {
  for (const p of children) {
    p.__stopping = true;
    try { process.kill(-p.pid, 'SIGTERM'); } catch {}
  }
}

async function waitFor(desc, fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    // 单次探测也要限时：一次挂住的 DB 查询会让整个等待（连同 fail-fast）静默卡死
    const probe = Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('单次探测超时 20s')), 20_000))]);
    try { if (await probe) return; } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`等待 ${desc} 超时 ${timeoutMs / 1000}s${last ? `：${last.message}` : ''}`);
}

async function startMlService(port) {
  const venv = process.env.ML_SERVICE_VENV || resolveLocalOnly('services/meridian-ml-service/.venv');
  const model = process.env.ML_MODEL_DIR || resolveLocalOnly('services/meridian-ml-service/model-cache');
  if (!venv || !model) throw new Error('找不到 ml-service 的 .venv 或 model-cache（设 ML_SERVICE_VENV / ML_MODEL_DIR）');
  spawnLogged('ml-service', path.join(venv, 'bin/uvicorn'), ['src.main:app', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: ML_DIR, // 用本 checkout 的 ml-service 代码（与被测 HEAD 一致），venv/模型只是运行环境
    env: { ...process.env, EMBEDDING_MODEL_NAME: model, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
  });
  await waitFor('ml-service /health', async () => (await fetch(`http://127.0.0.1:${port}/health`)).ok, 180_000);
}

async function startWrangler(configs, port, databaseUrl) {
  const env = { ...process.env, WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseUrl };
  delete env.CLOUDFLARE_API_TOKEN; // 本地模式用不到；也免得任何 remote 路径意外可用
  const argv = [...WRANGLER, 'dev', ...configs.flatMap((c) => ['-c', c]),
    '--port', String(port), '--ip', '127.0.0.1', '--persist-to', path.join(outDir, 'state'),
    '--inspector-port', String(await freePort()), '--show-interactive-dev-session=false'];
  const { logFile } = spawnLogged('wrangler', 'npx', argv, { cwd: BACKEND_DIR, env });
  log(`wrangler dev 启动中（日志 ${logFile}）`);
  await waitFor('wrangler dev', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/__r2/__probe__`);
    return r.status === 404;
  }, 240_000);
}

// ── 比对 ──────────────────────────────────────────────────────────────────
const STORY_FIELDS = ['cluster_id', 'title', 'importance', 'article_count', 'article_ids', 'selected_for_intel'];
const REPORT_FIELDS = ['title', 'content', 'tldr_prose', 'used_articles', 'used_sources'];
const RUN_FIELDS = ['status', 'total_articles', 'clusters_found', 'stories_identified', 'intelligence_analyses', 'brief_content_length'];
const BLOCK_FIELDS = ['clusterId', 'storyIdx', 'title', 'v6Title', 'tier', 'articles', 'tierArticles', 'sources', 'score', 'ok', 'text', 'sentences', 'anchors', 'windows', 'windowFailures', 'citationsRepaired', 'writeRejects', 'llmCalls', 'error'];

function compare(expected, actual) {
  const diffs = [];
  const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const field = (where, a, b) => {
    if (eq(a, b)) return;
    if (typeof a === 'string' && typeof b === 'string' && (a.includes('\n') || b.includes('\n') || a.length > 200)) {
      diffs.push(`## ${where}\n\`\`\`diff\n${unifiedDiff(a.endsWith('\n') ? a : a + '\n', b.endsWith('\n') ? b : b + '\n', 'production', 'replay')}\`\`\``);
    } else {
      diffs.push(`## ${where}\n- production: ${JSON.stringify(a)}\n- replay:     ${JSON.stringify(b)}`);
    }
  };
  for (const f of RUN_FIELDS) field(`brief_runs.${f}`, expected.run[f], actual.run?.[f]);
  for (const f of REPORT_FIELDS) field(`reports.${f}`, expected.report?.[f], actual.report?.[f]);
  field('brief_stories.count', expected.stories.length, actual.stories.length);
  const n = Math.max(expected.stories.length, actual.stories.length);
  for (let i = 0; i < n; i++) {
    for (const f of STORY_FIELDS) field(`brief_stories[${i}].${f}`, expected.stories[i]?.[f], actual.stories[i]?.[f]);
  }
  const eb = expected.briefV3?.blocks ?? [];
  const ab = actual.briefV3?.blocks ?? [];
  field('brief-v3.title', expected.briefV3?.title, actual.briefV3?.title);
  field('brief-v3.sections', expected.briefV3?.sections, actual.briefV3?.sections);
  field('brief-v3.blocks.count', eb.length, ab.length);
  for (let i = 0; i < Math.max(eb.length, ab.length); i++) {
    for (const f of BLOCK_FIELDS) field(`brief-v3.blocks[${i}].${f}`, eb[i]?.[f], ab[i]?.[f]);
  }
  return diffs;
}

// ── 主流程 ────────────────────────────────────────────────────────────────
async function main() {
  await fetchRecording(wf, { force: args.includes('--fetch') });
  const cred = credentials();
  if (!cred.databaseUrl) throw Object.assign(new Error('缺 REPLAY_DATABASE_URL（Neon 分支连接串）'), { exit: 2 });

  const store = new ReplayStore(path.join(dir, 'recording'), outDir);
  log(`录像 ${store.records.length} 条，唯一请求 ${store.queues.size} 个；逐句核查模式 ${store.checkMode}`);
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));

  const [replayPort, mlPort, wranglerPort] = [await freePort(), await freePort(), await freePort()];
  const apiToken = crypto.randomBytes(16).toString('hex');
  // 向量缓存跟着这一期走，跨重放复用；REPLAY_CF_API_BASE 只为把现算的请求指到别处（测试 / 排查）
  const vectors = new VectorCache(path.join(dir, 'vectors'), {
    apiBase: process.env.REPLAY_CF_API_BASE, accountId: CF_ACCOUNT_ID, token: cred.cfApiToken,
  });
  await startReplayServer(store, replayPort, vectors);
  const configs = generateConfigs({ store, replayPort, mlPort, apiToken });
  const base = `http://127.0.0.1:${wranglerPort}`;

  if (SLICE) {
    await startWrangler(configs, wranglerPort, cred.databaseUrl);
    return await runSlice(store, base);
  }

  log('启动 ml-service（真模型，本地）');
  await startMlService(mlPort);
  await startWrangler(configs, wranglerPort, cred.databaseUrl);

  // 本地 R2 播种：只放这一期需要的文章正文
  const articles = JSON.parse(fs.readFileSync(path.join(dir, 'articles.json'), 'utf8'));
  if (!SKIP_SEED) await mapLimit(articles, 16, async (a) => {
    const body = fs.readFileSync(path.join(dir, 'r2', a.key));
    const r = await fetch(`${base}/__seed/${encodeURIComponent(a.key)}`, { method: 'PUT', body });
    if (!r.ok) throw new Error(`播种 ${a.key} 失败: ${r.status}`);
  });
  log(SKIP_SEED ? '--skip-seed：本地 R2 保持为空（守卫自检）' : `本地 R2 播种 ${articles.length} 篇正文`);

  // 触发：生产那期的参数原样带上，只把「按时间窗取数」换成「按生产那期的文章 id 取数」
  const p = expected.run.params;
  const articleIds = articles.map((a) => a.id);
  const body = {
    ...p,
    article_ids: articleIds,
    articleLimit: Math.max(p.articleLimit ?? 0, articleIds.length),
    triggeredBy: 'replay',
  };
  delete body.dateFrom; delete body.dateTo;
  const trig = await fetch(`${base}/admin/briefs/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiToken}` },
    body: JSON.stringify(body),
  });
  const trigJson = await trig.json().catch(() => null);
  const replayWf = trigJson?.data?.workflowId;
  if (!replayWf) throw new Error(`触发失败 HTTP ${trig.status}: ${JSON.stringify(trigJson).slice(0, 300)}`);
  log(`workflow ${replayWf} 已启动`);

  const sql = pg(cred.databaseUrl);
  let run;
  try {
    let lastServed = -1;
    await waitFor('workflow 结束', async () => {
      if (FAIL_FAST && store.misses.length > 0) return true; // 先判 miss，不依赖 DB 查询
      [run] = await sql`select * from brief_runs where workflow_id = ${replayWf}`;
      if (store.served.length !== lastServed) {
        lastServed = store.served.length;
        log(`状态 ${run?.status ?? '(未落库)'}，已答 ${store.served.length} 次，miss ${store.misses.length}`);
      }
      return run && run.status !== 'RUNNING';
    }, 45 * 60_000);
    if (FAIL_FAST && store.misses.length > 0) {
      log('出现 miss，fail-fast 收尾（--no-fail-fast 可跑到底）');
      return finish(store, vectors, expected, { run: run ?? null, report: null, stories: [], briefV3: null }, replayWf);
    }
    // 最后几个 R2 落盘在 status 更新之后，给一点时间
    await new Promise((r) => setTimeout(r, 3000));
    const [report] = run.report_id ? await sql`select * from reports where id = ${run.report_id}` : [];
    const stories = await sql`select * from brief_stories where workflow_id = ${replayWf} order by id`;
    const v3res = await fetch(`${base}/__r2/${encodeURIComponent(`observability/brief-v3/${replayWf}.json`)}`);
    const briefV3 = v3res.ok ? await v3res.json() : null;
    const actual = { run, report: report ?? null, stories, briefV3 };
    fs.writeFileSync(path.join(outDir, 'actual.json'), JSON.stringify(actual, null, 1));
    return finish(store, vectors, expected, actual, replayWf);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function finish(store, vectors, expected, actual, replayWf) {
  const failures = [];
  // fail-fast 收尾时 workflow 还在半路，下面那些守卫与产出比对必然全红、全是噪声：只报 miss。
  const cutShort = FAIL_FAST && store.misses.length > 0;
  if (store.misses.length) failures.push(`replay miss ${store.misses.length} 次（本地发给 LLM 的请求与生产不同）`);
  if (vectors.failures.length) failures.push(`向量调用失败 ${vectors.failures.length} 批: ${vectors.failures[0]}`);
  let diffs = [];
  if (!cutShort) {
    // 假通过守卫：取不到正文时 workflow 会提前结束（TERMINATED_NO_STORIES 或 FAILED），LLM 段一次都不跑
    if (!actual.run || actual.run.status === 'TERMINATED_NO_STORIES' || actual.stories.length === 0) {
      failures.push(`假通过守卫：workflow 以 ${actual.run?.status} 结束、故事 ${actual.stories.length} 条——没有真正跑到 LLM 段`);
    }
    if (!actual.report) failures.push('没有生成 reports 行');
    if (store.served.length === 0) failures.push('替身一次都没被调用——LLM 段没跑');
    const unused = store.unused();
    if (unused.length) failures.push(`录像里有 ${unused.length} 条没被用到（本地少发了请求）: ${unused.slice(0, 10).join(', ')}${unused.length > 10 ? '…' : ''}`);
    const embedBatches = vectors.hits + vectors.computed;
    if (embedBatches !== store.embedBatchesRecorded) failures.push(`向量调用 ${embedBatches} 批，生产那期记的是 ${store.embedBatchesRecorded} 批（本地送去算向量的文本与生产不同）`);
    diffs = compare(expected, actual);
    if (diffs.length) failures.push(`产出与生产有 ${diffs.length} 处差异`);
  }

  const wall = ((Date.now() - t0) / 1000).toFixed(0);
  const md = [
    `# replay ${wf} → ${replayWf}`,
    '',
    `- 结果：${failures.length ? '**FAIL**' : '**PASS**'}`,
    `- 墙钟：${wall}s；作答 ${store.served.length} 次 / 录像 ${store.entries.length} 次请求；miss ${store.misses.length}；chat 调用花费 $0（全部来自录像）`,
    `- ${vectors.summary()}；生产那期记了 ${store.embedBatchesRecorded} 批`,
    `- workflow 状态：生产 ${expected.run.status} / 重放 ${actual.run?.status}`,
    ...failures.map((f) => `- ✗ ${f}`),
    ...store.misses.filter((m) => m.first).map((m) => `- miss #${m.n}（不同 diff 的首例）: ${m.why}（最接近 ${m.closest}）→ ${m.file}`),
    '',
    '# 差异（production vs replay）',
    '',
    cutShort ? '（fail-fast 收尾，未比对产出）' : diffs.length ? diffs.join('\n\n') : '（无）',
    '',
  ].join('\n');
  const reportFile = path.join(outDir, 'report.md');
  fs.writeFileSync(reportFile, md);
  console.log('\n' + md.split('\n').slice(0, 60).join('\n'));
  console.log(`\n完整报告: ${reportFile}`);
  return failures.length ? 1 : 0;
}

// 纵向切片：拿一条 cluster_judge 录像，从它的 prompt 还原请求体，打真实的 ai-worker 端点，
// 比端点解析出的结果与「用独立解析器解析生产那次的原始回复」是否一致。
async function runSlice(store, base) {
  const rec = store.records.find((r) => r.phase === 'cluster_judge');
  const prompt = rec.request.messages[0].content;
  const articles = [...prompt.split('报道：\n')[1].matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => ({ id: Number(m[1]), title: m[2] }));
  log(`切片：${rec.phase}-${rec.call_index}，${articles.length} 篇标题`);
  const r = await fetch(`${base}/__aiw/meridian/cluster/judge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ articles }),
  });
  const got = await r.json();
  const raw = rec.response.content.replace(/^[\s\S]*?```json\s*/, '').replace(/```[\s\S]*$/, '');
  const prod = JSON.parse(raw);
  const want = {
    verdict: String(prod.verdict).toUpperCase(), title: String(prod.title ?? '').trim(),
    event: String(prod.event ?? '').trim(), reason: String(prod.reason ?? '').trim(),
  };
  const same = got.success && JSON.stringify(got.data) === JSON.stringify(want);
  console.log(JSON.stringify({ http: r.status, endpoint: got, production: want, served: store.served, misses: store.misses.length }, null, 1));
  log(same && store.misses.length === 0 && store.served.length === 1 ? '切片 PASS：端点结果与生产一致' : '切片 FAIL');
  return same && store.misses.length === 0 && store.served.length === 1 ? 0 : 1;
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopAll(); process.exit(130); });
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error('[replay] 运行失败:', e?.stack || e);
  code = e?.exit ?? 1;
} finally {
  if (KEEP) {
    console.log('[replay] --keep：wrangler/ml-service 保持运行，Ctrl+C 结束');
  } else {
    stopAll();
  }
}
if (!KEEP) process.exit(code);
