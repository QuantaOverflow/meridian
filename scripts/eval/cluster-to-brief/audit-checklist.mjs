/**
 * 校核**核心层**事件清单 —— 覆盖率基准里唯一设门的那一层。零远程调用。
 *
 * 为什么只核核心层:通过门与 frontier 的覆盖轴都只读 `coverage.core`。
 * 次层/尾层的缺陷(2026-09-19 判官报出的施事搬错、重复条目)全部落在门外,修了不改变任何决定,
 * 已记为已知边界。dev 五簇的核心层合计只有 21 条,是能逐条核完的量。
 *
 * 每条事件给两组材料:
 *   · 全簇检索 top-6 —— 会把**同一事实的不同口径**捞出来(c43 的 1,107 与 1,087 就是这样被判官发现的)
 *   · 该事件每个 articleId 各自最匹配的一句 —— 看每篇支持文章到底写了什么
 *
 * 用法: node audit-checklist.mjs [--cluster=43]
 * 产出: out/_checklist-audit/pack-c<cid>.md  校核者读
 *       out/_checklist-audit/audit-c<cid>.json 校核者写
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import { loadExpectations, loadCluster, FIX } from './lib.mjs';
import { buildIndex, topK } from './retrieval.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = `${HERE}out/_checklist-audit`;
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)=?(.*)$/.exec(a);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
}));
const EXP = loadExpectations();
let targets = Object.entries(EXP.clusters).filter(([, e]) => e.split === 'dev');
if (args.cluster) targets = targets.filter(([c]) => c === String(args.cluster));

mkdirSync(OUT, { recursive: true });
let total = 0;

for (const [cid, exp] of targets) {
  const ckF = `${FIX}checklists/c${cid}.json`;
  if (!existsSync(ckF)) { console.error(`跳过 c${cid}: 缺清单`); continue; }
  const ck = JSON.parse(readFileSync(ckF, 'utf8'));
  const core = ck.events.map((e, i) => ({ ...e, eventId: i + 1 })).filter(e => e.nArticles >= ck.tiers.coreMin);
  if (!core.length) { console.log(`c${cid} 核心层为空,跳过`); continue; }

  const cluster = loadCluster(cid);
  const index = buildIndex(cluster, core.map(e => e.event), { outDir: `${HERE}out`, ns: 'audit' });

  const L = [`# 事件清单校核 · c${cid} ${exp.name}`, ''];
  L.push(`核心层 ${core.length} 条(门槛 ≥${ck.tiers.coreMin} 篇支持)。这一层是覆盖率唯一设门的地方。`);
  L.push('');
  L.push('## 你要做什么');
  L.push('');
  L.push('事件清单是由 `glm-4.7-flash` 从原文抽的,**没有经过人工核**。逐条核它写得对不对:');
  L.push('');
  L.push('1. **施事**——做这件事/说这句话的,和证据里是同一个人/机构吗?');
  L.push('   (已知一次真实错误:清单写 `Israeli forces killed...`,原句是 `Israeli settler fire killed...`)');
  L.push('2. **数字**——数量、金额、人数与证据一致吗?**簇内同一事实有没有两个不同口径**?');
  L.push('   有的话要记下来,清单锁死一个会让判官无法判定成稿写了另一个算不算错。');
  L.push('3. **时间**——日期、先后、「在…之前/之后」挂在同一件事上吗?');
  L.push('4. **地点**——清单有没有加上原句没有的地名?');
  L.push('5. **是不是单方声称**——证据里带 `X said` / `according to`,清单有没有写成既成事实?');
  L.push('');
  L.push('只依据下面摊开的证据判。**证据里看不出来就标 `unknown`,不要猜。**');
  L.push('');
  L.push('## 逐条');
  L.push('');
  const srcOf = new Map(cluster.articles.map(a => [a.id, a]));
  for (const e of core) {
    L.push(`### #${e.eventId}(${e.nArticles} 篇 / ${e.nSources} 源）`);
    L.push('');
    L.push(`> ${e.event}`);
    L.push('');
    L.push('清单登记的支持文章各自最匹配的一句:');
    for (const id of e.articleIds) {
      const a = srcOf.get(id);
      if (!a) { L.push(`- ${id}: ⚠️ 不在簇内`); continue; }
      let best = null, bestS = -1;
      a.sentences.forEach((t, i) => {
        const r = index.rows.findIndex(x => x.articleId === id && x.sentence === i + 1);
        if (r < 0) return;
        const q = index.qm.get(e.event);
        if (!q) return;
        const s = index.vecs[r].reduce((acc, v, k) => acc + v * q[k], 0);
        if (s > bestS) { bestS = s; best = { n: i + 1, t }; }
      });
      L.push(`- ${id}:${best?.n ?? '?'} (${String(a.title).slice(0, 46)})`);
      L.push(`  > ${best?.t ?? '(空)'}`);
    }
    L.push('');
    L.push('全簇检索 top-6(用来发现口径冲突与更准确的原句):');
    for (const [i, r] of topK(index, e.event, 6).entries()) {
      L.push(`- E${i + 1} ${r.articleId}:${r.sentence}`);
      L.push(`  > ${r.text}`);
    }
    L.push('');
  }

  L.push('## 把结论写进 JSON');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify({
    cluster: +cid,
    audits: [{ eventId: 1, verdict: 'ok', problems: [], correction: null, conflictingFigures: null, why: '一句话' }],
  }, null, 1));
  L.push('```');
  L.push('');
  L.push('- `verdict` ∈ `ok` / `wrong` / `unknown`');
  L.push('- `problems` 是字符串数组,取值 `actor` / `number` / `time` / `place` / `epistemic` / `duplicate`');
  L.push('- `wrong` 时 `correction` 写应该是什么(照证据改写这条事件)');
  L.push('- 簇内有两个口径时 `conflictingFigures` 写明两个值与各自出处,哪怕 verdict 是 ok');
  L.push(`- 必须覆盖全部 ${core.length} 条`);

  writeFileSync(`${OUT}/pack-c${cid}.md`, `${L.join('\n')}\n`);
  console.log(`c${cid} ${String(exp.name).padEnd(16)} 核心层 ${core.length} 条 → pack-c${cid}.md`);
  total += core.length;
}
console.log(`\n合计 ${total} 条核心层事件待核 → ${OUT}`);
