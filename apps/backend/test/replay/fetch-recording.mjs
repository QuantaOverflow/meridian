#!/usr/bin/env node
// 把一次生产 brief run 重放所需的全部输入拉到本地（只读生产，全部落 data/<wf>/，gitignored）：
//   recording/*.json   该 run 的每次 LLM 调用录像（生产 R2 llm-calls/，经 backend 只读路由）
//   clustering.json    该 run 的聚类快照（取输入文章集合）
//   r2/<key>           这些文章的正文（生产 R2 只读 GET，Cloudflare REST API）
//   expected.json      生产产出：brief_runs 行、reports 行、brief_stories 行（从 Neon 分支读——
//                      分支是生产的拷贝，这些行就是生产写下的）+ 生产 R2 的 brief-v3 块记录
//
// 用法：node fetch-recording.mjs <workflowId> [--force]
import fs from 'node:fs';
import path from 'node:path';
import { credentials, pg, runDir, mapLimit, PROD_BACKEND, CF_ACCOUNT_ID, PROD_BUCKET } from './lib.mjs';

async function getJson(url, token) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}: ${(await r.text()).slice(0, 200)}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
  }
}

async function getR2(key, cfToken) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${PROD_BUCKET}/objects/${encodeURIComponent(key)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${cfToken}` } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`R2 GET ${key}: HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
  }
}

export async function fetchRecording(wf, { force = false } = {}) {
  const dir = runDir(wf);
  const done = path.join(dir, '.fetched');
  if (fs.existsSync(done) && !force) {
    console.log(`[fetch] ${wf} 已在本地（${dir}），跳过；--fetch 强制重拉`);
    return;
  }
  const cred = credentials();
  if (!cred.prodApiToken) throw new Error('缺生产 backend API_TOKEN（MERIDIAN_API_TOKEN 或 apps/backend/.dev.vars 的 API_TOKEN）');
  if (!cred.cfApiToken) throw new Error('缺 CLOUDFLARE_API_TOKEN（读生产 R2 正文用，只读 GET）');
  if (!cred.databaseUrl) throw new Error('缺 REPLAY_DATABASE_URL（Neon 分支连接串，写在 test/replay/.replay.env）');
  fs.mkdirSync(path.join(dir, 'recording'), { recursive: true });

  // 1. LLM 录像
  const list = await getJson(`${PROD_BACKEND}/observability/runs/${wf}/llm-calls`, cred.prodApiToken);
  if (!list.success || !Array.isArray(list.calls)) throw new Error(`llm-calls 列表异常: ${JSON.stringify(list).slice(0, 200)}`);
  console.log(`[fetch] LLM 录像 ${list.calls.length} 条`);
  await mapLimit(list.calls, 8, async (c) => {
    const rec = await getJson(`${PROD_BACKEND}/observability/llm-calls/${c.key}`, cred.prodApiToken);
    fs.writeFileSync(path.join(dir, 'recording', path.basename(c.key)), JSON.stringify(rec, null, 1));
  });

  // 2. 聚类快照 → 输入文章集合
  const clustering = await getJson(`${PROD_BACKEND}/observability/runs/${wf}/clustering`, cred.prodApiToken);
  fs.writeFileSync(path.join(dir, 'clustering.json'), JSON.stringify(clustering, null, 1));
  const articleIds = [...new Set(clustering.clusters.flatMap((c) => c.articleIds))].sort((a, b) => a - b);
  console.log(`[fetch] 输入文章 ${articleIds.length} 篇（聚类快照里全部簇 + 噪声组的并集）`);

  // 3. 生产产出（oracle）+ 文章正文 key
  const sql = pg(cred.databaseUrl);
  try {
    const [run] = await sql`select * from brief_runs where workflow_id = ${wf}`;
    if (!run) throw new Error(`Neon 分支里没有 brief_runs ${wf}（分支是否建在该 run 之后？）`);
    const [report] = run.report_id ? await sql`select * from reports where id = ${run.report_id}` : [];
    const stories = await sql`select * from brief_stories where workflow_id = ${wf} order by id`;
    const articles = await sql`select id, content_file_key from articles where id in ${sql(articleIds)}`;
    if (articles.length !== articleIds.length) throw new Error(`分支里只找到 ${articles.length}/${articleIds.length} 篇文章`);
    const briefV3 = await getR2(`observability/brief-v3/${wf}.json`, cred.cfApiToken);
    fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify({
      run, report: report ?? null, stories,
      briefV3: briefV3 ? JSON.parse(briefV3.toString('utf8')) : null,
    }, null, 1));
    fs.writeFileSync(path.join(dir, 'articles.json'), JSON.stringify(articles.map((a) => ({ id: a.id, key: a.content_file_key })), null, 1));

    // 4. 正文
    let missing = 0;
    await mapLimit(articles, 16, async (a) => {
      const f = path.join(dir, 'r2', a.content_file_key);
      if (fs.existsSync(f) && !force) return;
      const body = await getR2(a.content_file_key, cred.cfApiToken);
      if (!body) { missing++; return; }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    });
    if (missing) throw new Error(`${missing} 篇正文在生产 R2 里取不到`);
    console.log(`[fetch] 正文 ${articles.length} 篇已落 ${path.join(dir, 'r2')}`);
  } finally {
    await sql.end();
  }
  fs.writeFileSync(done, new Date().toISOString());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const wf = process.argv[2];
  if (!wf) { console.error('用法: node fetch-recording.mjs <workflowId> [--force]'); process.exit(2); }
  fetchRecording(wf, { force: process.argv.includes('--force') }).catch((e) => { console.error(e); process.exit(1); });
}
