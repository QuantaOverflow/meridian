/**
 * 慢档阶段 B:给判官组装判定包。**零远程调用**(只跑本地 e5-small 做证据检索)。
 *
 * 分工:能机械判的归 verify.mjs(快档),需要读懂语义的归判官 —— 它就在迭代会话里,
 * 不必走 MCP。这个脚本只负责把判定所需的材料摊开,让判官读着判,再把判定写回 JSON,
 * 好让 score-slow.mjs 机械汇总、跨臂比较。
 *
 * 2026-09-19 改了三处(见 §「为什么证据换成检索」):
 *   · 事实正确性的证据由**脚本从整簇检索**,不再是成稿引的那句 —— 与成稿引了谁无关
 *   · 新增一维 `citedSentenceSuffices`:被引那句本身够不够,单列,不并进四档
 *   · 成稿正文里泄漏的行内引用号剥掉(它 100% 可识别臂身份,且会把判官带偏)
 *
 * 用法:
 *   node build-judge-pack.mjs --arm=out/arm-a                  # dev 五簇
 *   node build-judge-pack.mjs --arm=out/arm-a --split=heldout
 *   node build-judge-pack.mjs --arm=out/arm-a --cluster=36
 *
 * 产出: <arm>/judge-pack-c<cid>.md        判官读这个
 *       <arm>/judge-pack-c<cid>.meta.json 机械读数(检索缺口、剥掉的引用号),score-slow 读
 *       <arm>/verdict-c<cid>.json         判官写这个(脚本只生成骨架,不填内容)
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { loadExpectations, loadCluster, sentenceOf, gradedEventIds, FIX } from './lib.mjs';
import { buildIndex, topK, TOPK } from './retrieval.mjs';
import { gradingInstructions } from './grading-instructions.mjs';
import { scorerSrcId, packId } from './scorer-id.mjs';
import { renameSync, readdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)=?(.*)$/.exec(a);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
}));
if (!args.arm) { console.error('用法: node build-judge-pack.mjs --arm=<原型输出目录> [--split=dev|heldout|all] [--cluster=N]'); process.exit(2); }

const ARM = String(args.arm).replace(/\/$/, '');
/**
 * 这一轮判定包由哪个模型来判。**判官是 scorer 的一部分**,换模型就是换了一把尺 ——
 * opus 判的格子与 sonnet 判的格子放进同一张 frontier 表比较,会静默污染读数。
 * 落进 meta,由 `frontier.mjs` 断言同一轮全部格子一致。默认 `opus`(本仓迄今全部读数的模型)。
 */
const JUDGE_MODEL = String(process.env.JUDGE_MODEL ?? 'opus');
const SPLIT = String(args.split ?? 'dev');
const EXP = loadExpectations();

let targets = Object.entries(EXP.clusters);
if (args.cluster) targets = targets.filter(([c]) => c === String(args.cluster));
else if (SPLIT !== 'all') targets = targets.filter(([, e]) => e.split === SPLIT);
if (!targets.length) { console.error(`没有匹配的簇`); process.exit(2); }

mkdirSync(ARM, { recursive: true });
let built = 0;

let skippedForChecklist = 0, skippedForOutput = 0, rejected = 0;

/**
 * 剥掉成稿正文里泄漏的行内引用号(`[993794:9]` 这种)。
 * 两个理由:它 100% 可识别臂身份(2026-09-18 实测 A 臂 31/151 句带、B 臂 0 条);
 * 而且它本来就不该出现在给读者看的正文里(v1 有 21% 的句子带,却没有任何判据扣这个分)。
 * 剥完必须合并重复标点 —— 上一轮留下的 `,.` `,,.` 被 7 个判官里的 5 个当成缺陷报上来。
 */
const CITE_RE = /\s*[\[(]\s*\d{4,}\s*:\s*\d+(?:\s*[,;、]\s*\d{4,}\s*:\s*\d+)*\s*[\])]/g;
function stripInlineCitations(text) {
  const s = String(text ?? '');
  const hits = (s.match(CITE_RE) ?? []).length;
  let t = s.replace(CITE_RE, '');
  t = t.replace(/\s+([,.;:!?])/g, '$1');              // 标点前的空格
  t = t.replace(/([,.;:!?])(?:\s*[,.;:!?])+/g, (m) => m.trim().slice(-1)); // 连续标点只留最后一个
  t = t.replace(/\s{2,}/g, ' ').trim();
  return { text: t, stripped: hits };
}

for (const [cid, exp] of targets) {
  const outF = `${ARM}/c${cid}.json`;
  const ckF = `${FIX}checklists/c${cid}.json`;
  if (!existsSync(outF)) { console.error(`跳过 c${cid}: 缺原型输出 ${outF}`); skippedForOutput++; continue; }

  const out = JSON.parse(readFileSync(outF, 'utf8'));

  // 判不可写的簇没有正文可判,也就用不到事件清单 —— 这个分支必须排在缺清单的检查**之前**,
  // 否则缺清单会把它掩掉,看起来像"还没准备好",其实它已经不需要准备了。
  if (out.verdict === 'not_a_single_event') {
    writeFileSync(`${ARM}/verdict-c${cid}.json`, `${JSON.stringify({
      cluster: +cid, skipped: 'verdict=not_a_single_event,无正文可判', coverage: [], claims: [],
    }, null, 1)}\n`);
    console.log(`c${cid} ${String(exp.name).padEnd(16)} verdict=not_a_single_event,跳过判定`);
    rejected++;
    continue;
  }

  // 到这里才真的需要清单(要拿它当覆盖的基准)
  if (!existsSync(ckF)) { console.error(`跳过 c${cid}: 缺事件清单 ${ckF} —— 先跑 build-checklist.mjs`); skippedForChecklist++; continue; }
  const ck = JSON.parse(readFileSync(ckF, 'utf8'));
  const cluster = loadCluster(cid);

  const blocks = Array.isArray(out.blocks) ? out.blocks : [];

  // ── 先把全部成稿句摊平、剥引用号,再一次性建检索索引 ──────────────────
  const items = [];
  blocks.forEach((b, bi) => {
    (Array.isArray(b.sentences) ? b.sentences : []).forEach((s, si) => {
      const { text, stripped } = stripInlineCitations(s.text);
      items.push({ ref: `b${bi + 1}s${si + 1}`, bi, si, blockTitle: b.title ?? '(无标题)', text, stripped, sources: Array.isArray(s.sources) ? s.sources : [] });
    });
  });
  const index = buildIndex(cluster, items.map(i => i.text));

  const L = [];
  const meta = {
    cluster: +cid, arm: ARM, topK: TOPK, judgeModel: JUDGE_MODEL, scorerSrcId: scorerSrcId(),
    sentences: items.length,
    inlineCitationsStripped: items.reduce((n, i) => n + i.stripped, 0),
    sentencesWithStrippedCitations: items.filter(i => i.stripped).length,
    citedSources: 0, citedUnresolvable: 0, citedNotInEvidence: 0, sentencesWithoutSources: 0,
    perSentence: [],
  };

  L.push(`# 判定包 · c${cid} ${exp.name}`);
  L.push('');
  L.push(`簇规模 ${cluster.articles.length} 篇 · 形态 ${exp.form} · 待判事件 ${gradedEventIds(ck).length} 条(核心层门槛 ≥${ck.tiers.coreMin} 篇支持;尾层不判)`);
  L.push('');
  L.push(...gradingInstructions());
  L.push('## 事件清单(覆盖的基准)');
  L.push('');
  // 只列核心层 + 次层。尾层(单篇报道的细节)不进任何门、不进任何轴,判它纯属浪费生成量。
  const graded = gradedEventIds(ck);
  for (const id of graded) {
    const e = ck.events[id - 1];
    const tier = e.nArticles >= ck.tiers.coreMin ? '核心' : '次层';
    L.push(`${id}. [${tier} ${e.nArticles}篇/${e.nSources}源] ${e.event}`);
    // 簇内同一事实有多个口径时全列出来。不列的话清单锁死一个,成稿写了另一个(各有独立出处)
    // 就被判没命中 —— 罚的是它没做错的事。2026-09-19 校核:21 条核心层里 15 条有这种冲突。
    for (const v of e.variants ?? []) L.push(`   · 口径分歧：${v}`);
  }
  L.push('');
  L.push(`（编号是清单原编号,不连续是因为尾层 ${ck.events.length - graded.length} 条不在判定范围内。）`);
  L.push('');
  L.push('## 成稿(逐句编号)');
  L.push('');
  L.push(`每句下面两组材料:**声称的出处**(判 ③ 用)与**全簇检索证据 top-${TOPK}**(判 ② 用)。`);
  L.push('');

  let lastBi = -1;
  for (const it of items) {
    if (it.bi !== lastBi) { L.push(`### 块 ${it.bi + 1}: ${it.blockTitle}`); L.push(''); lastBi = it.bi; }
    L.push(`#### [${it.ref}] ${it.text}`);
    L.push('');

    // 声称的出处
    const citedKeys = new Set();
    L.push('声称的出处(只用于 ③):');
    if (!it.sources.length) { L.push('- ⚠️ 这句没有出处'); meta.sentencesWithoutSources++; }
    for (const sr of it.sources) {
      meta.citedSources++;
      const t = sentenceOf(cluster, sr?.articleId, sr?.sentence);
      const a = cluster.articles.find(x => x.id === sr?.articleId);
      if (t === undefined) meta.citedUnresolvable++; else citedKeys.add(`${sr.articleId}:${sr.sentence}`);
      L.push(`- ${sr?.articleId}:${sr?.sentence}${a ? ` (${String(a.title).slice(0, 50)}, ${a.publishDate?.slice(0, 10)})` : ''}`);
      L.push(`  > ${t === undefined ? '⚠️ 解析不到这句(编号越界或文章不在簇内)' : t}`);
    }
    L.push('');

    // 全簇检索证据
    const ev = topK(index, it.text);
    const evKeys = new Set(ev.map(r => `${r.articleId}:${r.sentence}`));
    const missed = [...citedKeys].filter(k => !evKeys.has(k));
    meta.citedNotInEvidence += missed.length;
    L.push(`全簇检索证据(判 ② 只看这一组,与成稿引了谁无关):`);
    ev.forEach((r, i) => {
      L.push(`- E${i + 1} ${r.articleId}:${r.sentence} (${String(r.title).slice(0, 50)}, ${r.publishDate?.slice(0, 10)})`);
      L.push(`  > ${r.text}`);
    });
    L.push('');
    meta.perSentence.push({ ref: it.ref, stripped: it.stripped, nSources: it.sources.length, citedNotInEvidence: missed.length, topScore: ev[0]?.score ?? null });
  }

  L.push('## 把判定写进 verdict 文件');
  L.push('');
  L.push(`默认 \`${ARM}/verdict-c${cid}.json\`。**若本轮的指令指定了别的文件名(多判官并行时会指定),以指令为准**`);
  L.push('—— 几个判官同时写同一个文件名会互相覆盖。');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify({
    cluster: +cid,
    coverage: { examined: gradedEventIds(ck).length, covered: [{ eventId: 1, where: 'b1s3' }] },
    claims: [{ sentenceRef: 'b1s3', claim: '这句里被核的那个断言', verdict: 'supported', tier: 'ok', citedSentenceSuffices: true, why: '一句话理由' }],
    packDefects: [],
  }, null, 1));
  L.push('```');
  L.push('');
  L.push('- `coverage.covered` **只列命中的事件**,每条 `{eventId, where}`;没命中的不用写,由脚本算');
  L.push('- `coverage.examined` 填你实际逐条看过的条数,应当等于上面列出的 ' + gradedEventIds(ck).length + ' 条');
  L.push('- `claims` 每句至少一条;一句里有多个可核断言就写多条,`sentenceRef` 相同');
  L.push('- `verdict` ∈ `supported` / `contradicted` / `not_found`;`tier` ∈ `fatal` / `hard` / `distortion` / `ok`');
  L.push('- `citedSentenceSuffices` ∈ `true` / `false`,**每条 claim 都要有**');
  L.push('- `packDefects` 是字符串数组,没发现就留空数组');
  L.push('- **判完落逐条明细**:同一份稿隔轮再判容易给出不同结果,下次复判要先读旧明细再判,不一致要说明为什么改');
  L.push('');
  L.push('写完跑 `node score-slow.mjs --arm=' + ARM + '` 汇总。');

  const md = `${L.join('\n')}\n`;
  meta.packId = packId(md);

  // ── 包变了就把旧判定搬走(「判据变了旧读数作废」的机械形态)──────────────────
  // 不搬走的后果不是报错,是**静默混用**:旧 verdict 的 coverage eventId 指向旧清单,
  // score-slow 照常算出一个数,没有任何地方会说"这两把尺不是同一把"。
  // 判据用的是**包内容**而不是源码清单:包一字不差就是判官当初看到的那份材料,判定仍然有效;
  // 而"哪些文件算 scorer"是要人维护的清单,漏一个就等于闸没关。
  const metaF = `${ARM}/judge-pack-c${cid}.meta.json`;
  if (existsSync(metaF)) {
    const old = JSON.parse(readFileSync(metaF, 'utf8'));
    if (old.packId && old.packId !== meta.packId) {
      const stale = readdirSync(ARM).filter(f => f.startsWith(`verdict-c${cid}`) && f.endsWith('.json'));
      if (stale.length) {
        const dir = `${ARM}/_stale-pack-${old.packId}`;
        mkdirSync(dir, { recursive: true });
        for (const f of stale) renameSync(`${ARM}/${f}`, `${dir}/${f}`);
        console.error(`⚠️ c${cid}: 判定包变了(${old.packId} → ${meta.packId}),${stale.length} 份旧判定已移到 ${dir}/ —— 必须重判,旧读数作废`);
      }
    }
  }

  writeFileSync(`${ARM}/judge-pack-c${cid}.md`, md);
  writeFileSync(metaF, `${JSON.stringify(meta, null, 1)}\n`);

  // 骨架只给形状,不预填判定 —— 预填会诱导判官照抄
  const skel = `${ARM}/verdict-c${cid}.json`;
  if (!existsSync(skel)) {
    writeFileSync(skel, `${JSON.stringify({ cluster: +cid, coverage: [], claims: [], packDefects: [] }, null, 1)}\n`);
  }

  console.log(
    `c${cid} ${String(exp.name).padEnd(16)} 块 ${blocks.length} · 句 ${items.length} · 清单 ${ck.events.length} 条 · ` +
    `剥引用号 ${meta.inlineCitationsStripped} 处 · 被引句未进检索证据 ${meta.citedNotInEvidence}/${meta.citedSources} → judge-pack-c${cid}.md`
  );
  built++;
}

console.log(`\n生成 ${built} 个判定包${rejected ? `,另有 ${rejected} 簇判不可写(已写 verdict,无需人判)` : ''}。`);
if (built) console.log('判官读 judge-pack-c*.md,判定写进 verdict-c*.json,然后跑 score-slow.mjs');

// 只要有簇因为缺东西被跳过,就必须用退出码说出来 —— 哪怕另有几簇判了不可写。
// 「3 簇判不可写 + 4 簇缺清单」也是没就绪:后续会把 exit 0 读成"准备好了",
// 接着去跑 score-slow 撞一堆环境错,而真正的阻塞(没跑 build-checklist)被埋在日志里。
if (skippedForChecklist || skippedForOutput) {
  console.error(
    `\n未就绪:缺原型输出 ${skippedForOutput} 簇、缺事件清单 ${skippedForChecklist} 簇(已生成 ${built} 个包、${rejected} 簇判不可写)。` +
    (skippedForChecklist ? '\n先跑 node build-checklist.mjs(需要本地 ai-worker 在 8787,会计费)' : '')
  );
  process.exit(2);
}
