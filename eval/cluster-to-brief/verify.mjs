/**
 * 快档 verifier —— 零 LLM、秒级、退出码表判定,给 codex 自主迭代用。
 *
 * 它只判**机械可判**的东西:schema 合规、出处能不能解析、出处编号有没有漏进正文、
 * 句子有没有写完、杂质率、数字有没有出处、块内是否跨事件。覆盖率与事实正确性属于慢档,要 LLM,不在这里。
 *
 * 为什么快档值得单独存在:这轮诊断出的主缺陷正是杂质(委内瑞拉/尼日尔混进 houthi 块),
 * 而它完全不需要 LLM 就能量——前提是原型输出每句的出处。
 *
 * ── 事实与判定分层(2026-09-20 重构)──────────────────────────────────────
 *   readCluster()   只出**事实**:读数 read + findings(某条检查发现了几处、实例是什么)
 *   applyPolicy()   只出**判定**:按 policy.json 把 findings 与阈值翻成过/不过
 *
 * 为什么要拆:上一版把读数、发现、过不过揉在一个函数里,判据里还写了「必须拆 ≥2 块」
 * (requireSplitOrReject / minBlocks)这种带架构假设的形状。架构从多块改成一簇一块后判据失效,
 * 三个臂已跑完的读数只能作废。现在通过线全在 policy.json:改产品目标只改它,历史读数照样可比,
 * 任何时候拿旧的 out/verify-*.json 重判都不用重新生成简报。判据写法的硬规矩见 CONTRACTS.md §4。
 *
 * ── 原型的输出契约(见 CONTRACTS.md §3)───────────────────────────────────
 * 每簇一个文件:<armDir>/c<clusterId>.json
 *
 *   {
 *     "cluster": 36,
 *     "verdict": "written" | "not_a_single_event",
 *     "reason": "...",                       // verdict=not_a_single_event 时必填
 *     "blocks": [                            // verdict=written 时至少 1 块
 *       {
 *         "title": "...",
 *         "sentences": [
 *           { "text": "...", "sources": [ { "articleId": 1009385, "sentence": 12 } ] }
 *         ]
 *       }
 *     ]
 *   }
 *
 * 出处是强制的:多条判据靠它。它对内部架构不构成限制——拆几步、传什么表示,都能标出处。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 *   node verify.mjs --arm=out/arm-a                 # 跑 dev 五簇
 *   node verify.mjs --arm=out/arm-a --split=heldout # 跑 heldout 两簇
 *   node verify.mjs --arm=out/arm-a --cluster=36    # 只跑一簇
 *   node verify.mjs --arm=out/arm-a --policy=p.json # 换一条通过线重判(读数不变)
 *
 * ── 退出码 ──────────────────────────────────────────────────────────────
 *   0  全部簇通过
 *   1  有簇未通过(逐项失败原因会打出来,并落 out/verify-<arm>-<split>.json)
 *   2  配置或数据问题(缺 fixture、缺输出文件、schema 不合规)——不是质量问题,先修环境
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { loadExpectations, loadCluster, sentenceOf, numbersIn, quotesIn, normQuote, proseSentences, OUT_ROOT, WORKSPACE } from './lib.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([^=]+)=?(.*)$/.exec(a);
    return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
  })
);
if (!args.arm) { console.error('用法: node verify.mjs --arm=<原型输出目录> [--split=dev|heldout|all] [--cluster=N] [--policy=<path>]'); process.exit(2); }

const ARM = String(args.arm).replace(/\/$/, '');
const SPLIT = String(args.split ?? 'dev');
const EXP = loadExpectations();

/**
 * 通过线的来源,优先级:--policy > 工作区自带 policy.json > 本目录默认 policy.json。
 * 工作区(CTB_WORKSPACE)换的是 fixture 与产物;通过线跟着工作区走,但换工作区不强制重写一份,
 * 缺了就落回默认那条线。
 */
const POLICY_PATH = args.policy
  ? String(args.policy)
  : existsSync(`${WORKSPACE}policy.json`) ? `${WORKSPACE}policy.json` : `${HERE}policy.json`;
if (!existsSync(POLICY_PATH)) { console.error(`缺 policy 文件: ${POLICY_PATH}`); process.exit(2); }
const POLICY = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));

let targets = Object.entries(EXP.clusters);
if (args.cluster) targets = targets.filter(([cid]) => cid === String(args.cluster));
else if (SPLIT !== 'all') targets = targets.filter(([, e]) => e.split === SPLIT);
if (!targets.length) { console.error(`没有匹配的簇(split=${SPLIT} cluster=${args.cluster ?? '-'})`); process.exit(2); }

const gates = name => POLICY.checks?.[name]?.gate === true;
const thresholdsFor = cid => ({ ...(POLICY.thresholds?.default ?? {}), ...(POLICY.thresholds?.clusters?.[String(cid)] ?? {}) });

// 句末标点:英文 . ? ! " ' ) 与中日韩对应的 。？！」』）""''…
// 2026-09-20 加。实例:`US President Donald Trump criticized the idea as ` —— 后面什么都没有。
// 这类句子读者一眼看得出没写完,而在此之前没有任何指标记录它。
const SENTENCE_END = /["'”’」』）)\]…。？！.?!]$/u;
// 出处编号漏进正文(2026-09-19 加):模型把输入里的 [articleId:sentence] 标签抄进了成稿,读者会看到。
// 也抓合并写法 [986133:3, 1006787:2],所以只匹配开头「[ + 编号:句号」。
// direct-raw 的 c1/c36/c51 都出现过。标题一并查。
const MARKER = /\[\s*\d{3,}\s*:\s*\d+/;

// ── 事实层:只出读数与 findings,不判过不过 ────────────────────────────────
function readCluster(cid, exp) {
  const envFail = [];               // 环境问题(缺文件/schema → exit 2)
  const read = {};                  // 读数,无论过不过都报
  const findings = {};              // check 名 → { count, examples }
  const note = (check, count, examples) => { findings[check] = { count, examples }; };

  const f = `${ARM}/c${cid}.json`;
  if (!existsSync(f)) { envFail.push(`缺输出文件 ${f}`); return { envFail, read, findings }; }

  let out;
  try { out = JSON.parse(readFileSync(f, 'utf8')); }
  catch (e) { envFail.push(`${f} 不是合法 JSON: ${e.message}`); return { envFail, read, findings }; }

  const cluster = loadCluster(cid);
  const impurities = new Set(exp.impurities ?? []);
  read.inputArticles = cluster.articles.length;
  read.inputImpurities = impurities.size;
  read.inputImpurityRate = +(impurities.size / cluster.articles.length).toFixed(3);

  // —— schema ——
  if (out.verdict !== 'written' && out.verdict !== 'not_a_single_event') {
    envFail.push(`verdict 必须是 written 或 not_a_single_event,拿到 ${JSON.stringify(out.verdict)}`);
    return { envFail, read, findings };
  }
  if (out.verdict === 'not_a_single_event' && !String(out.reason ?? '').trim()) {
    envFail.push('verdict=not_a_single_event 时 reason 必填');
  }
  const blocks = Array.isArray(out.blocks) ? out.blocks : [];
  if (out.verdict === 'written' && !blocks.length) envFail.push('verdict=written 但 blocks 为空');
  read.verdict = out.verdict;
  read.blocks = blocks.length;

  // —— 性质判据:块内不跨事件(noEventMixing)——————————————————————————
  // 2026-09-20 取代 requireSplitOrReject + minBlocks。判据只说输出性质:
  // **每个块引用的文章必须全部落在同一个 eventGroup 内**。谁来实现都适用 —— 一簇一块、拆多块、
  // 判 not_a_single_event 都能满足,所以旧臂的读数仍然可比。
  // 严格处:引到**未入组**的文章(单篇事件或杂质)即算不过。eventGroups 只列 ≥2 篇的事件,
  // 未入组要么是杂质(本来就不该写),要么是单篇事件(写进同一块就是把两件事混写),宁可误拒不误放。
  // 不同块可以各用不同的组;组与组之间的先后、篇数多少一律不管(旧版还要求「必须是篇数最多的那组」,
  // 那是结构偏好不是性质,已去掉 —— 见 README/报告里的口径变更记录)。
  {
    const groups = Object.entries(exp.eventGroups ?? {});
    const perBlock = [];            // 每块落在哪个组(null = 跨组或引到未入组)
    let mixed = 0;
    const examples = [];
    if (out.verdict === 'not_a_single_event') {
      read.eventMixingStatus = 'rejected';      // 判不可写永远满足
    } else if (!groups.length) {
      read.eventMixingStatus = 'unlabeled';     // 本簇没有 ≥2 篇的事件标注,判不了,不当通过也不当失败
    } else {
      blocks.forEach((b, bi) => {
        const cited = new Set((Array.isArray(b?.sentences) ? b.sentences : [])
          .flatMap(s => (Array.isArray(s?.sources) ? s.sources : []).map(sr => sr?.articleId))
          .filter(id => id !== undefined && id !== null));
        // 一句出处都没有的块不在这条判据里扣分 —— 它已经被 sentencesWithoutSource 那条抓住了,
        // 同一个缺陷不重复计。
        if (!cited.size) { perBlock.push(null); return; }
        const hit = groups.find(([, ids]) => [...cited].every(id => ids.includes(id)));
        perBlock.push(hit ? hit[0] : null);
        if (!hit) {
          mixed++;
          const ungrouped = [...cited].filter(id => !groups.some(([, ids]) => ids.includes(id)));
          const hitGroups = groups.filter(([, ids]) => [...cited].some(id => ids.includes(id))).map(([n]) => n);
          if (examples.length < 3) {
            examples.push(
              `块${bi + 1}「${String(b?.title ?? '').slice(0, 40)}」跨 ${hitGroups.length} 个事件` +
              `${hitGroups.length ? `(${hitGroups.map(n => n.slice(0, 28)).join(' / ')})` : ''}` +
              `${ungrouped.length ? `,另引 ${ungrouped.length} 篇未入组文章 [${ungrouped.slice(0, 5).join(',')}]` : ''}`
            );
          }
        }
      });
      read.eventMixingStatus = mixed ? 'mixed' : 'ok';
      read.blockEventGroups = perBlock;
      read.mixedBlocks = mixed;
      // 旧键 singleEvent(一块时落在哪个组)保留一个版本,免得旧脚本/旧对比表突然读到 undefined。
      // 语义有变:旧版只在 requireSplitOrReject 的簇上写,且要求是篇数最多的组;新版就是 blockEventGroups[0]。
      if (blocks.length === 1) read.singleEvent = perBlock[0] ?? null;
      if (mixed) note('noEventMixing', mixed, examples);
    }
  }

  // —— 逐句:出处解析、截断、杂质、数字 ——
  const allSents = blocks.flatMap(b => (Array.isArray(b.sentences) ? b.sentences : []));
  read.sentences = allSents.length;
  if (out.verdict === 'written' && allSents.length === 0 && !envFail.length) {
    envFail.push('blocks 里没有任何 sentences');
  }

  let unresolved = 0, noSource = 0, impureSents = 0, numbersMissing = 0, markerLeaks = 0, quotesMissing = 0;
  let truncated = 0;
  const impureExamples = [], unresolvedExamples = [], numberExamples = [], markerExamples = [], quoteExamples = [];
  const truncatedExamples = [];
  for (const b of blocks) {
    if (MARKER.test(String(b?.title ?? ''))) { markerLeaks++; if (markerExamples.length < 3) markerExamples.push(`标题 "${String(b.title).slice(0, 60)}"`); }
  }
  const citedImpurityIds = new Set();

  for (const s of allSents) {
    const text = String(s?.text ?? '');
    if (MARKER.test(text)) { markerLeaks++; if (markerExamples.length < 3) markerExamples.push(`"${text.slice(0, 70)}"`); }
    // 句末截断:去掉尾部空白后不以句末标点收尾 = 没写完
    const trimmed = text.trim();
    if (trimmed && !SENTENCE_END.test(trimmed)) {
      truncated++;
      if (truncatedExamples.length < 3) truncatedExamples.push(`"${trimmed.slice(-70)}"`);
    }
    const srcs = Array.isArray(s?.sources) ? s.sources : [];
    if (!srcs.length) {
      noSource++;
      if (unresolvedExamples.length < 3) unresolvedExamples.push(`无出处: "${text.slice(0, 60)}"`);
      continue;
    }
    const srcTexts = [];
    let sentImpure = false;
    for (const sr of srcs) {
      const t = sentenceOf(cluster, sr?.articleId, sr?.sentence);
      if (t === undefined) {
        unresolved++;
        if (unresolvedExamples.length < 3) unresolvedExamples.push(`解析不到 ${sr?.articleId}:${sr?.sentence}`);
      } else srcTexts.push(t);
      if (impurities.has(sr?.articleId)) { sentImpure = true; citedImpurityIds.add(sr.articleId); }
    }
    if (sentImpure) {
      impureSents++;
      if (impureExamples.length < 4) impureExamples.push(`"${text.slice(0, 70)}" ← 引了杂质文章`);
    }
    // 数字核对:句中非日期数字必须出现在所引原句里
    const srcNums = numbersIn(srcTexts.join(' '));
    const miss = [...numbersIn(text)].filter(n => !srcNums.has(n));
    if (miss.length) {
      numbersMissing++;
      if (numberExamples.length < 3) numberExamples.push(`"${text.slice(0, 55)}" 缺 [${miss.slice(0, 4)}]`);
    }
    // 正文引语核对(2026-09-19 加):引号内 ≥2 词的原话,归一后须是所引原句的子串。
    // 对不上 = 引语编造,或(更常见)原话在材料里但标错了出处。
    const srcNorm = normQuote(srcTexts.join(' '));
    const qMiss = quotesIn(text).filter(q => !srcNorm.includes(normQuote(q)));
    if (qMiss.length) {
      quotesMissing++;
      if (quoteExamples.length < 3) quoteExamples.push(`"${qMiss[0].slice(0, 60)}" 不在所引原句里`);
    }
  }

  // —— 块内冗余(2026-09-19 加)——————————————————————————————————————
  // 判据:**同一块内**两句引到同一条原句 → 这两句在讲同一件事。纯机械,零 LLM。
  // 为什么要量:实测 direct-raw 每 10 句就有 1 句在重复同块内说过的事,四个判官都主动报过,
  // 而在此之前没有任何指标记录它 —— 读者能直接感知,scorer 却看不见。
  // 实例:c37 块 3 的 5 句里两对重复(b3s1≈b3s3 都引 993147:15、b3s2≈b3s5 都引 993147:7)。
  let dupPairs = 0, dupSents = 0;
  const dupExamples = [];
  blocks.forEach((b, bi) => {
    const sents = Array.isArray(b.sentences) ? b.sentences : [];
    const keysOf = si => new Set((sents[si]?.sources ?? []).map(sr => `${sr?.articleId}:${sr?.sentence}`));
    const involved = new Set();
    for (let i = 0; i < sents.length; i++) {
      const ki = keysOf(i);
      if (!ki.size) continue;
      for (let j = i + 1; j < sents.length; j++) {
        const shared = [...keysOf(j)].filter(k => ki.has(k));
        if (!shared.length) continue;
        dupPairs++;
        involved.add(i); involved.add(j);
        if (dupExamples.length < 3) {
          dupExamples.push(`b${bi + 1}s${i + 1} / b${bi + 1}s${j + 1} 同引 ${shared[0]}: "${String(sents[i]?.text ?? '').slice(0, 45)}…"`);
        }
      }
    }
    dupSents += involved.size;
  });
  read.redundantPairs = dupPairs;
  read.redundantSentences = dupSents;
  read.redundancyRate = allSents.length ? +(dupSents / allSents.length).toFixed(3) : null;
  if (dupExamples.length) read.redundancyExamples = dupExamples;

  read.unresolvedSources = unresolved;
  read.sentencesWithoutSource = noSource;
  read.impureSentences = impureSents;
  read.impurityRate = allSents.length ? +(impureSents / allSents.length).toFixed(3) : null;
  read.citedImpurityArticles = citedImpurityIds.size;
  read.sentencesWithUncitedNumbers = numbersMissing;
  read.markerLeaks = markerLeaks;
  read.sentencesWithUncitedQuotes = quotesMissing;
  read.truncatedSentences = truncated;
  if (quoteExamples.length) read.quoteExamples = quoteExamples;
  if (truncatedExamples.length) read.truncatedExamples = truncatedExamples;

  if (unresolved) note('unresolvedSources', unresolved, unresolvedExamples);
  if (noSource) note('sentencesWithoutSource', noSource, unresolvedExamples);
  if (markerLeaks) note('markerLeaks', markerLeaks, markerExamples);
  if (truncated) note('truncatedSentences', truncated, truncatedExamples);
  if (numbersMissing) note('sentencesWithUncitedNumbers', numbersMissing, numberExamples);
  if (quotesMissing) note('sentencesWithUncitedQuotes', quotesMissing, quoteExamples);
  if (dupSents) note('redundantSentences', dupSents, dupExamples);
  if (impureSents) note('impurityRate', impureSents, impureExamples);

  return { envFail, read, findings };
}

// ── 判定层:findings + 阈值 → 过/不过。改这里等于改产品目标,所以数值全在 policy.json ──
function applyPolicy(cid, read, findings) {
  const fail = [], reported = [];
  const th = thresholdsFor(cid);
  const say = (check, msg) => (gates(check) ? fail : reported).push(`${msg}`);

  if (findings.unresolvedSources) say('unresolvedSources', `出处解析失败 ${findings.unresolvedSources.count} 处(编号越界或文章不在簇内): ${findings.unresolvedSources.examples.join(' | ')}`);
  if (findings.sentencesWithoutSource) say('sentencesWithoutSource', `${findings.sentencesWithoutSource.count} 句没有任何出处 —— 出处是契约的强制项: ${findings.sentencesWithoutSource.examples.join(' | ')}`);
  if (findings.markerLeaks) say('markerLeaks', `${findings.markerLeaks.count} 处正文或标题混入出处编号 [articleId:sentence],读者会看到: ${findings.markerLeaks.examples.join(' | ')}`);
  if (findings.truncatedSentences) say('truncatedSentences', `${findings.truncatedSentences.count} 句没有句末标点,是写到一半被截断: ${findings.truncatedSentences.examples.join(' | ')}`);
  if (findings.noEventMixing) say('noEventMixing', `${findings.noEventMixing.count} 个块跨事件(一块只许引同一个 eventGroup 的文章): ${findings.noEventMixing.examples.join(' | ')}`);

  // 杂质率:阈值来自 policy,只在 verdict=written 时生效(判不可写没有正文可量)
  if (read.verdict === 'written' && th.impurityRateMax !== null && th.impurityRateMax !== undefined && read.impurityRate !== null && read.impurityRate !== undefined) {
    // impurityRateStrict:必须**严格低于**上限 —— 选材这一步存在的意义就是筛
    const bad = th.impurityRateStrict ? read.impurityRate >= th.impurityRateMax : read.impurityRate > th.impurityRateMax;
    if (bad) {
      say('impurityRate',
        `杂质率 ${(read.impurityRate * 100).toFixed(1)}% ${th.impurityRateStrict ? '未严格低于' : '超过'} ` +
        `上限 ${(th.impurityRateMax * 100).toFixed(1)}%(输入杂质率 ${((read.inputImpurityRate ?? 0) * 100).toFixed(1)}%)` +
        (findings.impurityRate ? ` — 例: ${findings.impurityRate.examples.join(' | ')}` : ''));
    }
  }

  // 篇幅下限
  if (read.verdict === 'written' && th.minSentences && (read.sentences ?? 0) < th.minSentences) {
    say('minSentences', `只写了 ${read.sentences} 句,低于下限 ${th.minSentences}(干净簇写太薄同样不合格)`);
  }

  // 以下三条默认 gate=false —— 但也走同一个 say(),所以 policy 里一改 gate 就立刻成为门,
  // 不需要动代码。这正是把「设不设门」从代码里搬到 policy 的目的。
  if (findings.sentencesWithUncitedNumbers) say('sentencesWithUncitedNumbers', `数字无出处 ${findings.sentencesWithUncitedNumbers.count} 句: ${findings.sentencesWithUncitedNumbers.examples.join(' | ')}`);
  if (findings.sentencesWithUncitedQuotes) say('sentencesWithUncitedQuotes', `正文引语对不上所引原句 ${findings.sentencesWithUncitedQuotes.count} 句: ${findings.sentencesWithUncitedQuotes.examples.join(' | ')}`);
  if (findings.redundantSentences) say('redundantSentences', `块内冗余 ${findings.redundantSentences.count}/${read.sentences} 句(${read.redundantPairs} 对): ${findings.redundantSentences.examples.join(' | ')}`);

  return { fail, reported };
}

// ── 跑 ──────────────────────────────────────────────────────────────────
const results = {};
let failedClusters = 0, envProblems = 0;

for (const [cid, exp] of targets) {
  const { envFail, read, findings } = readCluster(cid, exp);
  const { fail, reported } = envFail.length ? { fail: [], reported: [] } : applyPolicy(cid, read, findings);
  results[cid] = {
    name: exp.name, form: exp.form, split: exp.split,
    pass: fail.length === 0 && envFail.length === 0,
    read, failures: fail, reported, envProblems: envFail,
  };
  if (envFail.length) envProblems++;
  else if (fail.length) failedClusters++;
}

// ── 报告 ────────────────────────────────────────────────────────────────
const armName = basename(ARM);
console.log(`\n快档 verifier · arm=${armName} · split=${SPLIT} · ${targets.length} 簇 · policy=${basename(POLICY_PATH)}@${POLICY.policyVersion ?? '?'}\n`);
console.log('簇    名称            形态                  判定   句数  杂质率(输入)      出处问题  跨事件');
for (const [cid, r] of Object.entries(results)) {
  const d = r.read;
  const imp = d.impurityRate === null || d.impurityRate === undefined
    ? '   —        '
    : `${(d.impurityRate * 100).toFixed(1)}% (${((d.inputImpurityRate ?? 0) * 100).toFixed(0)}%)`.padEnd(12);
  const srcIssue = (d.unresolvedSources ?? 0) + (d.sentencesWithoutSource ?? 0);
  const mix = d.eventMixingStatus === 'mixed' ? `${d.mixedBlocks}块`
    : d.eventMixingStatus === 'ok' ? '无'
      : d.eventMixingStatus === 'rejected' ? '判不可写'
        : d.eventMixingStatus === 'unlabeled' ? '未标注' : '—';
  console.log(
    `c${String(cid).padEnd(4)} ${String(r.name).padEnd(15)} ${String(r.form).padEnd(21)} ` +
    `${r.envProblems.length ? '环境' : r.pass ? ' ✅ ' : ' ❌ '}  ${String(d.sentences ?? '-').padStart(4)}  ${imp}  ${String(srcIssue).padEnd(8)}  ${mix}`
  );
}

for (const [cid, r] of Object.entries(results)) {
  if (!r.envProblems.length && !r.failures.length && !r.reported.length) continue;
  console.log(`\n── c${cid} ${r.name}`);
  for (const e of r.envProblems) console.log(`  [环境] ${e}`);
  for (const e of r.failures) console.log(`  [不合格] ${e}`);
  for (const e of r.reported) console.log(`  [读数] ${e}`);  // policy 里 gate=false 的检查,报而不拦
}

mkdirSync(OUT_ROOT, { recursive: true });
const outFile = `${OUT_ROOT}verify-${armName}-${SPLIT}.json`;
writeFileSync(outFile, `${JSON.stringify({
  arm: armName, split: SPLIT, at: new Date().toISOString(),
  // 记下按哪条通过线判的:读数是事实、判定是当时的目标,混在一起比就会拿不同的尺比不同的臂
  policy: { file: basename(POLICY_PATH), version: POLICY.policyVersion ?? null },
  results,
}, null, 1)}\n`);

console.log(`\n读数落盘: ${outFile}`);
console.log('注:这是快档 —— 覆盖率与事实正确性要慢档(LLM)才有,本次未判。');
console.log('注:杂质标注只依据标题、未读正文,所以杂质率是**下界**。');
console.log(`注:过/不过来自 ${basename(POLICY_PATH)};读数与它无关,换通过线可直接拿本文件重判。`);

if (envProblems) { console.error(`\n环境问题 ${envProblems} 簇 —— 先修环境,不是质量问题`); process.exit(2); }
if (failedClusters) { console.error(`\n不合格 ${failedClusters}/${targets.length} 簇`); process.exit(1); }
console.log(`\n✅ ${targets.length}/${targets.length} 簇通过快档`);
