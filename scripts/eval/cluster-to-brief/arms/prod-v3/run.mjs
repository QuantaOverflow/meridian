/**
 * prod-v3：生产写作链路本身作为一个臂（不是原型）——直接打本地 ai-worker 的两个生产端点，
 * 一簇一次 report-v3 + 一次 write-block-v3，产物转成输出契约。目的只有一个：拿到生产链路
 * 在同一把尺下的第一份读数，此前从未量过。
 *
 * 与其它臂不同：这里没有窗口切分、没有候选句选择、没有任何原型专属的中间步骤——
 * 这些都在 ai-worker 内部（services/report-v3.ts、services/brief-writer-v3.ts），本臂只是照
 * apps/backend 调它们的方式转发一次。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { splitSentences } from '../../lib.mjs';
import { runArm } from '../../runner.mjs';

// 生产端点的 base：本地 ai-worker 已经跑在 8787（CLAUDE.md 的本地验证方法）。
const BASE = process.env.PROD_V3_BASE_URL ?? 'http://localhost:8787';
// 生产分层三档（apps/backend/src/lib/core/brief-v3.ts assignTiers）里的中间档，
// 落不进头条配额也落不进简讯配额的故事走这一档——是三档里覆盖面最大的默认档。
const TIER = 'more';

async function postJSON(path, body, tag, callsPath) {
  const t0 = Date.now();
  let http = 0, json = null, err = '';
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    });
    http = res.status;
    json = await res.json();
    if (!json?.success) err = JSON.stringify(json?.error ?? json).slice(0, 300);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const wall_s = +((Date.now() - t0) / 1000).toFixed(2);
  appendFileSync(callsPath, `${JSON.stringify({ tag, path, wall_s, http, ok: !!json?.success, err })}\n`);
  console.log(`  [${tag}] ${wall_s}s http=${http} ok=${!!json?.success}${err ? ` err=${err}` : ''}`);
  if (!json?.success) throw new Error(`${tag} 失败: ${err || `http ${http}`}`);
  return json.data;
}

/**
 * 写作层没有逐句 sources，靠 marks 拼回来：marks[].sentence 命中哪句就用它的 factIds 去
 * report.facts 里找对应事实的 sources[]，多条事实的 sources 合并去重。
 *
 * 句子列表本身不用 marks（代码检查器会对分数不够的句子弃权，marks 覆盖不满全部句子），
 * 改用与生产报告层同构的切句器切 text，保证每一句都出现在契约里；拼不出出处的句子 sources
 * 留空数组——这正是我们要看到的读数（verify.mjs 记成 sentencesWithoutSource），不要伪造。
 */
function assembleSentences(text, marks, facts) {
  const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const markByNorm = new Map((marks ?? []).map(m => [norm(m.sentence), m]));
  const factsById = new Map((facts ?? []).map(f => [f.id, f]));
  return splitSentences(text).map(t => {
    const mark = markByNorm.get(norm(t));
    const sources = [];
    if (mark) {
      const seen = new Set();
      for (const factId of mark.factIds) {
        for (const src of factsById.get(factId)?.sources ?? []) {
          const key = `${src.articleId}:${src.sentence}`;
          if (seen.has(key)) continue;
          seen.add(key);
          sources.push({ articleId: src.articleId, sentence: src.sentence });
        }
      }
    }
    return { text: t, sources };
  });
}

/**
 * 跑一个样本。`sample.input.cluster` 是 runner 已经载好的 `{ clusterId, articles }`
 * （`{id, title, url, publishDate, sourceId, content, sentences}[]`），与 backend
 * `buildReportV3` 要的 `{id, title, url, publishDate, content}` 逐字对得上。
 */
export async function runSample(sample, options = {}) {
  const t0 = Date.now();
  const clusterId = sample.input.clusterId;
  const cluster = sample.input.cluster;
  const OUT = options.outDir;
  console.log(`c${clusterId}: ${cluster.articles.length} 篇 -> report-v3 + write-block-v3(tier=${TIER})`);
  if (options.plan) return;

  mkdirSync(OUT, { recursive: true });
  const callsPath = `${OUT}/calls.jsonl`;

  // 步骤 1：report-v3。--resume 且已有缓存报告就复用，避免真实计费调用重复发生。
  const reportCachePath = `${OUT}/c${clusterId}-report.json`;
  let reportPayload;
  if (options.resume && existsSync(reportCachePath)) {
    reportPayload = JSON.parse(readFileSync(reportCachePath, 'utf8'));
    console.log(`  [c${clusterId}-report] 复用缓存`);
  } else {
    const articles = cluster.articles.map(a => ({ id: a.id, title: a.title, url: a.url, publishDate: a.publishDate, content: a.content }));
    // title：生产传的是这条 story 的标题（来自聚类分层），这里没有这个字段，传空串——
    // ai-worker 对空 title 本就有兜底（body?.title ?? ''），不是本臂另发明的行为。
    reportPayload = await postJSON('/meridian/report-v3', { title: '', articles, skipCache: true }, `c${clusterId}-report`, callsPath);
    writeFileSync(reportCachePath, JSON.stringify(reportPayload));
  }
  const report = reportPayload.report;

  // 步骤 2：write-block-v3。report 内联传（与 backend 一致：上一步的产物直接转发，不再读一次 R2）。
  const writePayload = await postJSON('/meridian/write-block-v3', { report, tier: TIER, skipCache: true }, `c${clusterId}-write`, callsPath);
  const { text, marks, trace: writeTrace } = writePayload;

  const sentences = assembleSentences(text, marks, report.facts);
  const output = {
    cluster: clusterId,
    // 生产写作层这一步没有「判不可写」——故事能走到这里，说明更早的验证/选取层已经认了它是一件事。
    verdict: 'written',
    blocks: [{
      // 生产这一步没有标题（标题是 /meridian/brief-title，整篇起一次，不按块）。不为对比多花一次
      // LLM 调用：用 report.summary 的前 60 字占位，标清楚这不是生产的真标题。
      title: `[非生产标题，占位] ${report.summary.slice(0, 60)}`,
      sentences,
    }],
  };
  writeFileSync(`${OUT}/c${clusterId}.json`, JSON.stringify(output, null, 2));

  // 排错用 trace：report 去掉 sentences（等价于原文、体积大，本地已经有一份），marks/text/两段 trace 全留。
  const { sentences: _articleSentences, ...reportLite } = report;
  writeFileSync(`${OUT}/c${clusterId}-prod.json`, JSON.stringify({
    cluster: clusterId,
    report: reportLite,
    reportTrace: reportPayload.trace,
    write: { text, marks, trace: writeTrace },
  }, null, 2));

  const elapsed = +((Date.now() - t0) / 1000).toFixed(2);
  const noSource = sentences.filter(s => !s.sources.length).length;
  console.log(`c${clusterId}: written, ${sentences.length} 句（${noSource} 句无出处）, ${elapsed}s`);
}

export const meta = {
  name: 'prod-v3',
  consumerId: () => 'prod-v3',
};

async function main() {
  const { ids, outDir } = await runArm({ meta, runSample });
  console.log(`\nDone: ${ids.map(x => `c${x}`).join(', ')} -> ${outDir}`);
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  main().catch(e => { console.error(e); process.exitCode = 2; });
}
