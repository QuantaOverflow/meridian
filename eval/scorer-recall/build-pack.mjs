/**
 * 给判官组装「检出能力」判定包。**零远程调用**(本地 e5-small 做证据检索)。
 *
 * 这个 harness 量的不是简报好不好,是 **scorer 自己看不看得见错误**。
 * 材料是 2026-09-18 手工逐句标注过的 82 句自然候选句,其中 15 句含事实错(形状:60% actor、20% time)。
 * 判官判完,`score-recall.mjs` 拿判定对金标算召回与误拦 —— 这是 operating point,不是猜测。
 *
 * 为什么不造注入题:同一份文档实测过,人工注入 60 条(quantity/actor/polarity/state/scope 各 12)
 * 的形状与自然分布对不上 —— polarity 与 scope 在 83 句自然候选里**一条都没出现**,
 * 而占自然 20% 的时序错在注入体系里**连类别都没有**;自然的 actor 错 6/9 是
 * 「两条各自正确的事实被融成一句」,单点替换造不出这个形状。
 * 结论写死在那份文档里:**在注入题上测出的召回不可外推**。所以只用自然金标。
 *
 * 用法:
 *   node build-pack.mjs                      # 全部 12 个 block
 *   node build-pack.mjs --block=c0-lead
 *   node build-pack.mjs --variant=actor      # 换一版 grading instructions(单变量对照)
 *
 * 产出: out/<variant>/pack-<block>.md   判官读
 *       out/<variant>/meta-<block>.json 机械读数
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { splitSentences } from '../cluster-to-brief/lib.mjs';
import { buildIndex, topK, TOPK } from '../cluster-to-brief/retrieval.mjs';
import { loadRunCluster, loadBlocks } from './corpus.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)=?(.*)$/.exec(a);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
}));
const VARIANT = String(args.variant ?? 'base');
if (!['base', 'actor'].includes(VARIANT)) { console.error(`未知 variant: ${VARIANT}`); process.exit(2); }
const OUT = `${HERE}out/${VARIANT}`;
mkdirSync(OUT, { recursive: true });

/**
 * 评分守则。**base 与 cluster-to-brief 的判定包逐字同源** —— 这个 harness 量的就是那把 scorer,
 * 守则一改就不是同一把了。actor 变体只动被标出的那一段,其余保持不变(单变量)。
 */
function instructions(variant) {
  const L = [];
  L.push('## 你要判的事');
  L.push('');
  L.push('成稿每一句写得对不对。**证据范围写死:只看该句下面「全簇检索证据」那一组。**');
  L.push('那一组是脚本拿这句话去整簇原文里检索出来的。');
  L.push('');
  L.push('| 档 | 定义 |');
  L.push('|---|---|');
  L.push('| `fatal` | 改变事件的性质、严重程度或空间/因果关系,读者据此形成完全错误认知 |');
  L.push('| `hard` | 事实错但不改变故事性质,多为日期/主体搬错 |');
  L.push('| `distortion` | 方向对但读者会形成偏差印象 |');
  L.push('| `ok` | 正确的推断、合理省略、明示的判断语,都不扣分 |');
  L.push('');
  L.push('检索证据里既找不到支持也找不到反证时,先分清是哪一种:');
  L.push('**成稿编的** → 按上表判档;**检索没捞到**(你能看出这件事本簇多半报道过,只是没被检索到)');
  L.push('→ 标 `ok`,并在 `why` 里写「疑似检索缺口」。');
  L.push('');
  L.push('**顺序不能反:先核事实,再读文风。** 先把每个数字、每个主体、每个否定词对着证据比一遍,再谈流畅度。');
  L.push('');
  if (variant === 'base') {
    L.push('**判不准的归属类错误标 `ok` 并说明,不要硬猜。** 主体/日期搬错这类错你召回很低,');
    L.push('宁可漏报,也别造一个假的 `hard`。');
  } else {
    // actor 变体:把"宁可漏报"换成一道**必做的逐项核对**。改的只有这一段。
    L.push('**每一句都要先做一遍归属核对,再定档。** 逐项对着证据回答,答不上来的那一项就是错:');
    L.push('');
    L.push('1. 这句话把某个动作/说法/立场**安给了谁**?证据里做这件事、说这句话的是**同一个人/机构**吗?');
    L.push('2. 这句话里的**时间**(日期、先后、"在…之前/之后")在证据里挂在**同一件事**上吗?');
    L.push('3. 这句话是不是把证据里**两条分开的事实**并成了一句?并的时候有没有把 A 的谓语、条件或时间挂到 B 头上?');
    L.push('4. 这句话陈述为既成事实的内容,证据里是不是**某一方的声称**(带 said/claimed/据称)?');
    L.push('');
    L.push('三条里任何一条对不上就按档表判,**不要因为"不确定"就标 `ok`**。');
    L.push('确实无法判断时标 `ok`,但必须在 `why` 里写清是上面哪一项无法判断、缺什么证据。');
  }
  L.push('');
  L.push('**发现本文件本身有缺陷就说出来**(证据错配、抓取噪声、检索缺口……),写进 `packDefects` 数组。');
  return L;
}

const blocks = loadBlocks().filter(b => !args.block || b.block === String(args.block));
if (!blocks.length) { console.error('没有匹配的 block'); process.exit(2); }

// 一个簇的索引跨 block 复用(lead/more/brief 同簇)
const idxCache = new Map();
function indexFor(cid, queries) {
  if (!idxCache.has(cid)) idxCache.set(cid, buildIndex(loadRunCluster(cid), queries, { outDir: OUT, ns: 'run' }));
  return idxCache.get(cid);
}

// 同簇的 block 一起建索引,省 embed 进程
const byCluster = new Map();
for (const b of blocks) {
  if (!byCluster.has(b.cluster)) byCluster.set(b.cluster, []);
  byCluster.get(b.cluster).push(b);
}

let totalSents = 0;
for (const [cid, bs] of byCluster) {
  const allSents = bs.map(b => splitSentences(b.text));
  const index = indexFor(cid, allSents.flat());

  bs.forEach((b, bi) => {
    const sents = allSents[bi];
    const L = [`# 检出能力判定包 · ${b.block}`, ''];
    L.push(`簇 c${cid} · ${loadRunCluster(cid).articles.length} 篇原文 · 成稿 ${sents.length} 句`);
    L.push('');
    L.push('这条流水线**不标逐句出处**,所以本包只判事实正确性一件事,没有覆盖、没有引用维。');
    L.push('');
    L.push(...instructions(VARIANT));
    L.push('');
    L.push('## 成稿(逐句编号)');
    L.push('');
    const meta = { block: b.block, cluster: cid, variant: VARIANT, topK: TOPK, sentences: sents.length, perSentence: [] };
    sents.forEach((s, si) => {
      const ref = `s${si + 1}`;
      L.push(`### [${ref}] ${s}`);
      L.push('');
      const ev = topK(index, s);
      L.push('全簇检索证据:');
      ev.forEach((r, i) => {
        L.push(`- E${i + 1} ${r.articleId}:${r.sentence}`);
        L.push(`  > ${r.text}`);
      });
      L.push('');
      meta.perSentence.push({ ref, topScore: ev[0]?.score ?? null });
    });
    L.push('## 把判定写进 verdict 文件');
    L.push('');
    L.push('```json');
    L.push(JSON.stringify({
      block: b.block,
      claims: [{ sentenceRef: 's1', claim: '被核的那个断言', verdict: 'supported', tier: 'ok', why: '一句话理由' }],
      packDefects: [],
    }, null, 1));
    L.push('```');
    L.push('');
    L.push(`- \`claims\` 覆盖全部 ${sents.length} 句,每句至少一条,\`sentenceRef\` 形如 \`s3\``);
    L.push('- `verdict` ∈ `supported` / `contradicted` / `not_found`;`tier` ∈ `fatal` / `hard` / `distortion` / `ok`');
    L.push('- 落盘文件名以本轮指令为准(多判官并行时会指定不同文件名)');

    writeFileSync(`${OUT}/pack-${b.block}.md`, `${L.join('\n')}\n`);
    writeFileSync(`${OUT}/meta-${b.block}.json`, `${JSON.stringify(meta, null, 1)}\n`);
    totalSents += sents.length;
    console.log(`${b.block.padEnd(11)} c${String(cid).padEnd(3)} 句 ${String(sents.length).padStart(2)} → pack-${b.block}.md`);
  });
}
console.log(`\nvariant=${VARIANT} · ${blocks.length} 个 block · ${totalSents} 句 → ${OUT}`);
