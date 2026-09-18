/**
 * 慢档阶段 B:给 codex 组装判定包。**零 LLM、纯组装。**
 *
 * 分工:能机械判的归 verify.mjs(快档),需要读懂语义的归 codex —— 它就在迭代会话里,
 * 不必走 MCP。这个脚本只负责把判定所需的材料摊开,让 codex 读着判,再把判定写回 JSON,
 * 好让 score-slow.mjs 机械汇总、跨臂比较。
 *
 * 用法:
 *   node build-judge-pack.mjs --arm=out/arm-a                  # dev 五簇
 *   node build-judge-pack.mjs --arm=out/arm-a --split=heldout
 *   node build-judge-pack.mjs --arm=out/arm-a --cluster=36
 *
 * 产出: <arm>/judge-pack-c<cid>.md   codex 读这个
 *       <arm>/verdict-c<cid>.json    codex 写这个(脚本只生成骨架,不填内容)
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { loadExpectations, loadCluster, sentenceOf, FIX } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)=?(.*)$/.exec(a);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
}));
if (!args.arm) { console.error('用法: node build-judge-pack.mjs --arm=<原型输出目录> [--split=dev|heldout|all] [--cluster=N]'); process.exit(2); }

const ARM = String(args.arm).replace(/\/$/, '');
const SPLIT = String(args.split ?? 'dev');
const EXP = loadExpectations();

let targets = Object.entries(EXP.clusters);
if (args.cluster) targets = targets.filter(([c]) => c === String(args.cluster));
else if (SPLIT !== 'all') targets = targets.filter(([, e]) => e.split === SPLIT);
if (!targets.length) { console.error(`没有匹配的簇`); process.exit(2); }

mkdirSync(ARM, { recursive: true });
let built = 0;

let skippedForChecklist = 0, skippedForOutput = 0, rejected = 0;

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
  const L = [];

  L.push(`# 判定包 · c${cid} ${exp.name}`);
  L.push('');
  L.push(`簇规模 ${cluster.articles.length} 篇 · 形态 ${exp.form} · 事件清单 ${ck.events.length} 条(核心层门槛 ≥${ck.tiers.coreMin} 篇支持)`);
  L.push('');
  L.push('## 你要判两件事');
  L.push('');
  L.push('**① 覆盖** —— 事件清单里每一条,成稿有没有告诉读者这件事?');
  L.push('措辞不必相同,说到了就算命中。清单是从原文独立抽的,不是从成稿抽的。');
  L.push('');
  L.push('**② 正确性** —— 成稿每一句,对照它所引的原句,写得对不对?分四档:');
  L.push('');
  L.push('| 档 | 定义 |');
  L.push('|---|---|');
  L.push('| `fatal` | 改变事件的性质、严重程度或空间/因果关系,读者据此形成完全错误认知 |');
  L.push('| `hard` | 事实错但不改变故事性质,多为日期/主体搬错 |');
  L.push('| `distortion` | 方向对但读者会形成偏差印象 |');
  L.push('| `ok` | 正确的推断、合理省略、明示的判断语,都不扣分 |');
  L.push('');
  L.push('**顺序不能反:先核事实,再读文风。** 你和写作层可能是同一个模型,');
  L.push('self-preference 泄漏会让你觉得自己的输出更顺 —— 先把每个数字、每个主体、');
  L.push('每个否定词对着原句比一遍,再谈流畅度。');
  L.push('');
  L.push('已知你判不出来的:**主体/日期搬错这类归属错误召回很低**。判不准就标 `ok` 并在 `why` 里说明,');
  L.push('不要硬猜——宁可漏报,也别造一个假的 `hard`。');
  L.push('');
  L.push('---');
  L.push('');
  L.push('## 事件清单(覆盖的基准)');
  L.push('');
  ck.events.forEach((e, i) => {
    const tier = e.nArticles >= ck.tiers.coreMin ? '核心' : e.nArticles >= 2 ? '次层' : '尾层';
    L.push(`${i + 1}. [${tier} ${e.nArticles}篇/${e.nSources}源] ${e.event}`);
  });
  L.push('');
  L.push('---');
  L.push('');
  L.push('## 成稿(逐句编号,附所引原句)');
  L.push('');

  blocks.forEach((b, bi) => {
    L.push(`### 块 ${bi + 1}: ${b.title ?? '(无标题)'}`);
    L.push('');
    const sents = Array.isArray(b.sentences) ? b.sentences : [];
    sents.forEach((s, si) => {
      const ref = `b${bi + 1}s${si + 1}`;
      L.push(`**[${ref}]** ${s.text ?? ''}`);
      const srcs = Array.isArray(s.sources) ? s.sources : [];
      if (!srcs.length) L.push('  - ⚠️ 这句没有出处');
      for (const sr of srcs) {
        const t = sentenceOf(cluster, sr?.articleId, sr?.sentence);
        const meta = cluster.articles.find(a => a.id === sr?.articleId);
        L.push(`  - 出处 ${sr?.articleId}:${sr?.sentence}${meta ? ` (${String(meta.title).slice(0, 50)}, ${meta.publishDate?.slice(0, 10)})` : ''}`);
        L.push(`    > ${t === undefined ? '⚠️ 解析不到这句(编号越界或文章不在簇内)' : t}`);
      }
      L.push('');
    });
  });

  L.push('---');
  L.push('');
  L.push('## 把判定写进这个文件');
  L.push('');
  L.push(`\`${ARM}/verdict-c${cid}.json\``);
  L.push('');
  L.push('```json');
  L.push(JSON.stringify({
    cluster: +cid,
    coverage: [{ eventId: 1, covered: true, where: 'b1s3' }],
    claims: [{ sentenceRef: 'b1s3', claim: '这句里被核的那个断言', verdict: 'supported', tier: 'ok', why: '一句话理由' }],
  }, null, 1));
  L.push('```');
  L.push('');
  L.push('- `coverage` 要覆盖清单全部 ' + ck.events.length + ' 条,`eventId` 是上面的序号(1-based)');
  L.push('- `claims` 每句至少一条;一句里有多个可核断言就写多条,`sentenceRef` 相同');
  L.push('- `verdict` ∈ `supported` / `contradicted` / `not_found`;`tier` ∈ `fatal` / `hard` / `distortion` / `ok`');
  L.push('- **判完落逐条明细**:同一份稿隔轮再判容易给出不同结果,下次复判要先读旧明细再判,不一致要说明为什么改');
  L.push('');
  L.push('写完跑 `node score-slow.mjs --arm=' + ARM + '` 汇总。');

  writeFileSync(`${ARM}/judge-pack-c${cid}.md`, `${L.join('\n')}\n`);

  // 骨架只给形状,不预填判定 —— 预填会诱导 codex 照抄
  const skel = `${ARM}/verdict-c${cid}.json`;
  if (!existsSync(skel)) {
    writeFileSync(skel, `${JSON.stringify({ cluster: +cid, coverage: [], claims: [] }, null, 1)}\n`);
  }

  const nSents = blocks.reduce((n, b) => n + (b.sentences?.length ?? 0), 0);
  console.log(`c${cid} ${String(exp.name).padEnd(16)} 块 ${blocks.length} · 句 ${nSents} · 清单 ${ck.events.length} 条 → judge-pack-c${cid}.md`);
  built++;
}

console.log(`\n生成 ${built} 个判定包${rejected ? `,另有 ${rejected} 簇判不可写(已写 verdict,无需人判)` : ''}。`);
if (built) console.log('codex 读 judge-pack-c*.md,判定写进 verdict-c*.json,然后跑 score-slow.mjs');

// 只要有簇因为缺东西被跳过,就必须用退出码说出来 —— 哪怕另有几簇判了不可写。
// 「3 簇判不可写 + 4 簇缺清单」也是没就绪:codex 会把 exit 0 读成"准备好了",
// 接着去跑 score-slow 撞一堆环境错,而真正的阻塞(没跑 build-checklist)被埋在日志里。
if (skippedForChecklist || skippedForOutput) {
  console.error(
    `\n未就绪:缺原型输出 ${skippedForOutput} 簇、缺事件清单 ${skippedForChecklist} 簇(已生成 ${built} 个包、${rejected} 簇判不可写)。` +
    (skippedForChecklist ? '\n先跑 node build-checklist.mjs(需要本地 ai-worker 在 8787,会计费)' : '')
  );
  process.exit(2);
}
