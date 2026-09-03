/**
 * 【扔掉型原型】用要点补全被截掉的文章，能不能救回独家角度？
 *
 * 病：`collapseGroup` 把合并后的文章按时间均匀抽到 30 篇，超出的直接丢（8 期实测丢 71 篇）。
 * 抽样对题材是盲的——"death toll rises" 几十篇抽掉一批主干还在，"两份报告几个月前就预警过"
 * 只有 2 篇，可能一篇不剩。
 *
 * 30 这个上限是**延迟护栏**不是上下文护栏：2026-08-30 实测 91 篇正文 = 283k 字符 → 300 秒硬超时。
 * 而同样 91 篇的 `event_summary_points` 只有 39.5k 字符，小 7.2 倍——比现在送的 30 篇正文
 * （约 93k）还小 2.4 倍。所以「正文 30 篇 + 其余只给要点」在尺寸上完全装得下。
 *
 * 零生产改动即可验：`/meridian/intelligence/analyze-single-story` 渲染的是 `articleData[].content`，
 * 传什么渲染什么。尾部文章的 content 直接填要点即可。
 *
 * 两臂（同一批文章、同一端点、skipCache）：
 *   A 现状   按时间均匀取 30 篇，content = 正文
 *   B 混合   同样 30 篇正文 + 其余 61 篇 content = 要点（标注为 SUMMARY ONLY）
 *
 * 判据：codex 读者评审点名的「报道数少但内容独有」的支线，进没进报告。关键词命中 + 人读。
 *
 * 跑法：npx tsx intel-summary-tail.ts [--n 91] [--conc 8]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const WORKER = 'https://meridian-ai-worker.swj299792458.workers.dev/meridian/intelligence/analyze-single-story';
const WF = 'admin-brief-1788058777778';
const CAP = 30;
const CACHE = new URL('./.cache/', import.meta.url).pathname;
const args = process.argv.slice(2);
const argOf = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const CONC = Number(argOf('--conc', '8'));
mkdirSync(CACHE + 'content/', { recursive: true });

const DB = readFileSync('/Users/shiwenjie/Desktop/playground/projects/meridian/apps/frontend/.env', 'utf-8')
  .split('\n').find((l) => l.startsWith('NUXT_DATABASE_URL='))!.slice(18).replace(/"/g, '');
// 带重试：Neon 冷启动会直接断连（"server closed the connection unexpectedly"）
function psql(q: string): string[][] {
  for (let k = 0; ; k++) {
    try {
      return execFileSync('psql', [DB, '-At', '-F', '\t', '-c', q],
        { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
    } catch (e) { if (k >= 4) throw e; execFileSync('sleep', ['3']); }
  }
}

interface Art { id: number; title: string; url: string; pub: string; key: string; esp: string[]; content: string }
const rows = psql(`SELECT a.id, coalesce(a.title,''), coalesce(a.url,''), coalesce(a.publish_date::text,''),
    coalesce(a.content_file_key,''), coalesce(a.event_summary_points::text,'[]')
  FROM articles a WHERE a.id IN (
    SELECT DISTINCT jsonb_array_elements_text(article_ids::jsonb)::int FROM brief_stories
    WHERE workflow_id='${WF}' AND cluster_id=47)
  ORDER BY a.publish_date`);
const arts: Art[] = rows.map((r) => ({ id: Number(r[0]), title: r[1], url: r[2], pub: r[3], key: r[4],
  esp: JSON.parse(r[5]) as string[], content: '' }));
if (arts.length !== 91) throw new Error(`卫生断言失败：期望 91 篇，拿到 ${arts.length}`);
if (arts.some((a) => !a.key)) throw new Error('卫生断言失败：有文章没有 content_file_key');
if (arts.some((a) => !a.esp.length)) throw new Error('卫生断言失败：event_summary_points 未 100% 覆盖');

// R2 取正文（缓存到本地，重跑不重取）
async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let cur = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cur < items.length) { const i = cur++; await fn(items[i], i); }
  }));
}
let fetched = 0;
await pool(arts, CONC, async (a) => {
  const f = `${CACHE}content/${a.id}.txt`;
  if (existsSync(f)) { a.content = readFileSync(f, 'utf-8'); return; }
  try {
    a.content = execFileSync('npx', ['wrangler', 'r2', 'object', 'get', `meridian-articles-prod/${a.key}`, '--remote', '--pipe'],
      { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
        cwd: '/Users/shiwenjie/Desktop/playground/projects/meridian/apps/backend' });
    writeFileSync(f, a.content);
  } catch { a.content = ''; }
  if (++fetched % 15 === 0) process.stderr.write(`  R2 ${fetched}\n`);
});
const empty = arts.filter((a) => !a.content.trim()).length;
if (empty > arts.length * 0.1) throw new Error(`卫生断言失败：${empty}/${arts.length} 篇正文取空，超过 10%`);
console.log(`91 篇：正文 ${arts.reduce((n, a) => n + a.content.length, 0)} 字符（空 ${empty} 篇）｜` +
  `要点 ${arts.reduce((n, a) => n + a.esp.join('').length, 0)} 字符\n`);

/** 生产 pickSpreadArticles 的两端锚定等距抽样 */
function pickSpread(list: Art[], cap: number): Art[] {
  if (list.length <= cap) return list;
  const step = (list.length - 1) / (cap - 1);
  const out = new Set<Art>();
  for (let i = 0; i < cap; i++) out.add(list[Math.round(i * step)]);
  return [...out];
}
const head = pickSpread(arts, CAP);                              // 与生产同一批 30 篇
const headIds = new Set(head.map((a) => a.id));
const tail = arts.filter((a) => !headIds.has(a.id));
console.log(`A 臂：${head.length} 篇正文｜B 臂：${head.length} 篇正文 + ${tail.length} 篇要点\n`);

const asArticle = (a: Art, mode: 'full' | 'summary') => ({
  id: a.id, title: a.title, url: a.url, publishDate: a.pub,
  content: mode === 'full' ? a.content
    : `[SUMMARY ONLY — key points extracted from this report, not its full text]\n` +
      a.esp.map((p) => `- ${p}`).join('\n'),
});
const story = { title: 'Nepal-Tibet flash floods', importance: 8,
  articleIds: arts.map((a) => a.id), storyType: 'SINGLE_STORY' };

async function analyze(articleData: any[]): Promise<{ ms: number; report: any; chars: number }> {
  const t0 = Number(process.hrtime.bigint() / 1000000n);
  const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ story: { ...story, articleIds: articleData.map((a) => a.id) },
      articleData, options: { analysis_depth: 'detailed' }, skipCache: true }) });
  const j: any = await r.json();
  // 卫生：调用失败必须炸，不能当成「有效报告但 0 命中」——上一轮就是这么读出假读数的
  if (j?.success === false) throw new Error(`端点返回失败：${j?.error}`);
  const rep = j?.data ?? j;
  if (rep?.status === 'incomplete') throw new Error(`报告 incomplete：${rep?.reason}`);
  if (JSON.stringify(rep ?? {}).length < 1000) throw new Error(`报告过短（${JSON.stringify(rep ?? {}).length} 字符），疑似失败：${JSON.stringify(rep).slice(0, 200)}`);
  return { ms: Number(process.hrtime.bigint() / 1000000n) - t0, report: rep,
    chars: articleData.reduce((n: number, a: any) => n + a.content.length, 0) };
}

// codex 读者评审点名的「报道数少但内容独有」支线。命中 = 报告正文里出现该角度
const PROBES: Array<[string, RegExp]> = [
  ['灾前预警（两份报告几个月前警告过）', /warn(ed|ing)s? (of|about)|report(s)? (had )?warned|months? (before|earlier)|prior warning/i],
  ['冰川融化/气候归因', /melting glacier|climate change|glacial retreat|warming/i],
  ['中铁路项目安全反思', /rail(way)? project|rail link|safety rethink|flagship rail/i],
  ['卫星/雷达证据', /satellite|radar|remote sensing/i],
  ['西藏侧信息封锁', /not being shown|censor|information (black-?out|control)|little is known about/i],
  ['边检人员疏散', /police officer|guiding people away|border (guard|officer)/i],
  ['联合国儿童需求', /17,?000 children|UNICEF|children in urgent need/i],
  ['尼泊尔拒绝外援', /declin(e|ed) (foreign|international)|refus(e|ed) (foreign|help)|don'?t need help/i],
];
const flatten = (r: any): string => JSON.stringify(r ?? {});

/**
 * 四臂拆「超时到底由什么驱动」：A(92.6k字/30条) 124 秒过，B(123k字/91条) 300 秒超时。
 * 字符只多 33%，时间翻 2.4 倍以上 ⇒ 瓶颈不是字符数。
 *   D 91 条全要点（约 40k 字 / 91 条）：字符最少但条目最多 —— 若仍超时，驱动量是条目数
 *   C 30 正文 + 20 要点（约 101k 字 / 50 条）：中间点，找可用边界
 */
const ARMS: Array<[string, any[]]> = [
  ['A 30正文', head.map((a) => asArticle(a, 'full'))],
  ['B 30正文+61要点', [...head.map((a) => asArticle(a, 'full')), ...tail.map((a) => asArticle(a, 'summary'))]],
];
// ⚠️ 噪声地板：A 臂同一输入两次跑，独家角度命中 1/8 与 3/8 —— 单次读数不可用，必须重复。
// 这与 article-prompt-slim 那轮的教训同源：改动的效应必须先超过噪声地板才算数。
const REPEATS = Number(argOf('--repeats', '3'));
const out: any = {};
for (const [baseName, data] of ARMS) for (let rep = 0; rep < REPEATS; rep++) {
  const name = `${baseName} #${rep + 1}`;
  console.log(`── ${name}：${data.length} 篇，输入 ${data.reduce((n, a) => n + a.content.length, 0)} 字符，调用中…`);
  let res: { ms: number; report: any; chars: number };
  try { res = await analyze(data as any[]); }
  catch (e) {
    console.log(`   ❌ ${e instanceof Error ? e.message.slice(0, 90) : e}\n`);
    out[name] = { failed: String(e).slice(0, 200), items: data.length,
      inputChars: data.reduce((n, a) => n + a.content.length, 0) };
    continue;
  }
  const txt = flatten(res.report);
  const hits = PROBES.filter(([, re]) => re.test(txt)).map(([n]) => n);
  console.log(`   耗时 ${(res.ms / 1000).toFixed(0)}s｜报告 ${txt.length} 字符｜status=${res.report?.status ?? 'ok'}`);
  console.log(`   独家角度命中 ${hits.length}/${PROBES.length}：${hits.join('、') || '无'}`);
  console.log(`   未命中：${PROBES.filter(([n]) => !hits.includes(n)).map(([n]) => n).join('、') || '无'}\n`);
  out[name] = { ms: res.ms, items: data.length, inputChars: res.chars, reportChars: txt.length, hits, report: res.report };
}
writeFileSync('intel-summary-tail-out.json', JSON.stringify(out, null, 1));
console.log('\n═══ 汇总（每臂 ' + REPEATS + ' 次）');
for (const [baseName] of ARMS) {
  const rs = Object.entries(out).filter(([k]) => k.startsWith(baseName)).map(([, v]) => v as any).filter((v) => !v.failed);
  if (!rs.length) { console.log(`${baseName}：全部失败`); continue; }
  const hitCounts = rs.map((r) => r.hits.length);
  const union = new Set(rs.flatMap((r) => r.hits));
  const always = PROBES.map(([n]) => n).filter((n) => rs.every((r) => r.hits.includes(n)));
  console.log(`${baseName.padEnd(18)} 成功 ${rs.length}/${REPEATS}｜命中 ${hitCounts.join(',')}（均 ${(hitCounts.reduce((a, b) => a + b, 0) / rs.length).toFixed(1)}/8）` +
    `｜并集 ${union.size}/8｜每次都中 ${always.length}/8｜耗时 ${rs.map((r) => (r.ms / 1000).toFixed(0)).join(',')}s`);
  console.log(`   并集：${[...union].join('、')}`);
}
console.log('\n报告全文落 intel-summary-tail-out.json，下一步人读比对');
