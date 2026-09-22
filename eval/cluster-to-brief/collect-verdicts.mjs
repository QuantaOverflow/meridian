/**
 * 判官产物的验收闸。**「判官自报完成」不算完成，退出码才算。**
 *
 * 为什么要有:2026-09-20 那轮三个临时判官判了 51 篇 / 248 句,其中一个自报「done」而输出文件
 * 根本没落盘 —— 差点直接采用它报的比例。自报状态不是验收,LLM 说完成和文件在磁盘上是两件事。
 *
 * 四道闸,各管一种「不报错的错」:
 *   · 文件在不在   —— 自报完成、实际没写(上面那次)。
 *   · schema 合不合 —— 标成 `unsure`/漏 `reason`,汇总时要么崩要么被当成 pass,两个方向都偏。
 *   · 覆盖全不全   —— 漏判几句会让分母悄悄缩小,比例照样算得出来、而且看着正常。
 *   · promptId 对不对 —— 规格文件改过之后的旧判定,是另一把尺量出来的。
 *     CONTRACTS.md §5 写着「promptId 不同的判定不可混用」,这里是那句话的退出码形态。
 *
 * 指纹从内容算(沿用 scorer-id.mjs 的 sha256 前 10 位),不手写版本号:手写的会忘记改,
 * 而忘记改恰好等于关掉这道闸。
 *
 * 用法:
 *   node collect-verdicts.mjs --run=out/<runId> --axis=citation-support
 *   node collect-verdicts.mjs --axis=citation-support --prompt-id   # 只打印指纹,派判官时抄给它
 *
 * 退出码: 0 全部齐全且合规;2 有缺失/不合规 —— 结果一律不采用。
 */
import { readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = new URL('.', import.meta.url).pathname;

/**
 * 六轴。`scope` 决定「一条判定对应什么」:
 *   sentence —— 逐句判,ref = b<块>s<句>。
 *   brief    —— 整篇一条,ref = brief(多事件混写问的是整篇,拆到句上问不出来)。
 */
export const AXES = {
  'citation-support': { scope: 'sentence' },
  'invented-fact': { scope: 'sentence' },
  'invented-relation': { scope: 'sentence' },
  'actor-swap': { scope: 'sentence' },
  'strength-distortion': { scope: 'sentence' },
  'event-mixing': { scope: 'brief' },
};

const short = s => createHash('sha256').update(s).digest('hex').slice(0, 10);

/** 规格文件的指纹 = 判官那一把尺的身份。`--judges=<dir>` 只为自测换目录用。 */
export function promptId(axis, judgesDir = `${HERE}judges`) {
  const f = `${String(judgesDir).replace(/\/$/, '')}/${axis}.md`;
  if (!existsSync(f)) throw new Error(`缺规格文件 ${f}`);
  return short(readFileSync(f, 'utf8'));
}

/**
 * 一份成稿里所有句子的 ref。**编号规则必须与 build-judge-pack.mjs 逐字一致**
 * (`b${bi + 1}s${si + 1}`),否则判官写回的 ref 与这里期望的对不上,而对不上会被报成漏判。
 * 空文本的句子不算 —— 它们在判定包里也不出现。
 */
export function refsOf(brief) {
  const refs = [];
  for (const [bi, b] of (Array.isArray(brief?.blocks) ? brief.blocks : []).entries()) {
    for (const [si, s] of (Array.isArray(b?.sentences) ? b.sentences : []).entries()) {
      if (typeof s?.text === 'string' && s.text.trim()) refs.push(`b${bi + 1}s${si + 1}`);
    }
  }
  return refs;
}

/**
 * 这个 run 里有哪些样本要判。
 *
 * 优先读 `run.json` 的 `samples`(契约 §2):**样本失败是一等状态**,`status=error` 的样本
 * 不该被要求判定,但必须单独列出个数 —— 悄悄少一个样本正是这里要防的。
 * 没有 run.json 的旧目录退化成扫 `c<数字>.json`(排除 `c7-run.json` / `c7-anchors.json` 这类边料)。
 */
export function samplesOf(runDir) {
  const dir = String(runDir).replace(/\/$/, '');
  if (!existsSync(dir)) throw new Error(`run 目录不存在: ${dir}`);

  let ids = null;
  const notOk = [];
  const runF = `${dir}/run.json`;
  if (existsSync(runF)) {
    const meta = JSON.parse(readFileSync(runF, 'utf8'));
    if (meta && typeof meta.samples === 'object' && meta.samples) {
      ids = [];
      for (const [cid, s] of Object.entries(meta.samples)) {
        if ((s?.status ?? 'ok') === 'ok') ids.push(Number(cid));
        else notOk.push({ cluster: Number(cid), status: s?.status, error: s?.error ?? '' });
      }
    }
  }
  if (!ids) {
    ids = readdirSync(dir)
      .map(f => /^c(\d+)\.json$/.exec(f))
      .filter(Boolean)
      .map(m => Number(m[1]));
  }
  ids.sort((a, b) => a - b);

  const samples = [];
  for (const cluster of ids) {
    const f = `${dir}/c${cluster}.json`;
    if (!existsSync(f)) { samples.push({ cluster, briefFile: f, missingBrief: true, refs: [] }); continue; }
    let brief;
    try { brief = JSON.parse(readFileSync(f, 'utf8')); }
    catch (e) { samples.push({ cluster, briefFile: f, badBrief: String(e.message), refs: [] }); continue; }
    samples.push({ cluster, briefFile: f, verdict: brief.verdict ?? null, refs: refsOf(brief) });
  }
  return { samples, notOk };
}

/**
 * 一份判定文件的 schema 与覆盖检查。返回人话的问题清单(空 = 合规)。
 * 覆盖和 schema 放一起查,是因为漏判与写错格式在汇总时的表现一样:一个看着正常的数。
 */
export function verdictProblems(v, { axis, cluster, expectedRefs, expectPromptId }) {
  const P = [];
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return ['不是 JSON 对象'];

  if (v.axis !== axis) P.push(`axis 应为 "${axis}",实为 ${JSON.stringify(v.axis)}`);
  if (Number(v.cluster) !== Number(cluster)) P.push(`cluster 应为 ${cluster},实为 ${JSON.stringify(v.cluster)}`);
  if (typeof v.promptId !== 'string' || !v.promptId) P.push('promptId 缺失或不是字符串');
  else if (v.promptId !== expectPromptId) {
    // 规格文件在判完之后改过 —— 这批判定是另一把尺量的,混进同一张表不会报错,只会给出一个看着正常的值
    P.push(`promptId 过期: 文件里是 ${v.promptId},judges/${axis}.md 当前是 ${expectPromptId} —— 规格改过,这批判定作废,重判`);
  }
  if (v.packDefects !== undefined && !Array.isArray(v.packDefects)) P.push('packDefects 存在但不是数组');

  if (!Array.isArray(v.judgements)) { P.push('judgements 缺失或不是数组'); return P; }

  const seen = new Map();
  for (const [i, j] of v.judgements.entries()) {
    const at = `judgements[${i}]`;
    if (j === null || typeof j !== 'object' || Array.isArray(j)) { P.push(`${at} 不是对象`); continue; }
    if (typeof j.ref !== 'string' || !j.ref) { P.push(`${at} ref 缺失`); continue; }
    if (j.label !== 'pass' && j.label !== 'fail') P.push(`${at} (${j.ref}) label 必须是 pass/fail,实为 ${JSON.stringify(j.label)}`);
    // 旗标必须可复核:2026-09-20 那 72 条旗标复核下来只有约 22% 是读者可见的错,
    // 而没有理由的旗标连复核都做不了。pass 不强制,省掉 248 句 × 6 轴的无效文字。
    if (j.label === 'fail' && (typeof j.reason !== 'string' || !j.reason.trim())) P.push(`${at} (${j.ref}) label=fail 必须给 reason`);
    if (j.reason !== undefined && typeof j.reason !== 'string') P.push(`${at} (${j.ref}) reason 不是字符串`);
    if (seen.has(j.ref)) P.push(`${j.ref} 判了两次(judgements[${seen.get(j.ref)}] 与 ${at})—— 二元轴一句只能一条`);
    else seen.set(j.ref, i);
  }

  const expected = new Set(expectedRefs);
  const missing = expectedRefs.filter(r => !seen.has(r));
  const unknown = [...seen.keys()].filter(r => !expected.has(r));
  if (missing.length) P.push(`漏判 ${missing.length} 条: ${missing.join(' ')} —— 漏判会让分母悄悄缩小`);
  if (unknown.length) P.push(`成稿里没有这些 ref: ${unknown.join(' ')}`);
  return P;
}

/** 验收一个 run 的一轴。返回 { ok, expectPromptId, rows, notOk, problems } —— 不打印、不退出。 */
export function collect({ runDir, axis, judgesDir = `${HERE}judges` }) {
  if (!AXES[axis]) throw new Error(`未知 axis: ${axis}(可选: ${Object.keys(AXES).join(' ')})`);
  const dir = String(runDir).replace(/\/$/, '');
  const expectPromptId = promptId(axis, judgesDir);
  const { samples, notOk } = samplesOf(dir);
  const scope = AXES[axis].scope;

  const rows = [];
  const problems = [];
  const bad = (cluster, kind, msg) => problems.push({ cluster, kind, msg });
  for (const s of samples) {
    const file = `${dir}/verdicts/${axis}-c${s.cluster}.json`;
    const row = { cluster: s.cluster, file, state: '', nRefs: 0 };

    if (s.missingBrief) { row.state = 'no-brief'; bad(s.cluster, 'no-brief', `c${s.cluster} 成稿文件不存在: ${s.briefFile}`); rows.push(row); continue; }
    if (s.badBrief) { row.state = 'bad-brief'; bad(s.cluster, 'bad-brief', `c${s.cluster} 成稿不是合法 JSON: ${s.badBrief}`); rows.push(row); continue; }

    // 判不可写的簇没有正文可判(契约 §3),不要求判定文件 —— 它合格与否由快档的二元判据决定
    if (s.verdict === 'not_a_single_event' || s.refs.length === 0) { row.state = 'skipped'; rows.push(row); continue; }

    const expectedRefs = scope === 'brief' ? ['brief'] : s.refs;
    row.nRefs = expectedRefs.length;

    if (!existsSync(file)) { row.state = 'missing'; bad(s.cluster, 'missing', `c${s.cluster} 缺判定文件: ${file}`); rows.push(row); continue; }
    let v;
    try { v = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { row.state = 'unparseable'; bad(s.cluster, 'unparseable', `c${s.cluster} 判定文件不是合法 JSON (${file}): ${e.message}`); rows.push(row); continue; }

    const p = verdictProblems(v, { axis, cluster: s.cluster, expectedRefs, expectPromptId });
    if (p.length) { row.state = 'invalid'; for (const x of p) bad(s.cluster, 'invalid', `c${s.cluster} ${x}`); }
    else row.state = 'ok';
    rows.push(row);
  }

  const graded = rows.filter(r => r.state !== 'skipped');
  if (!graded.length) bad(null, 'empty', `这个 run 里没有任何要判的样本 —— 先确认 ${dir} 里有成稿`);
  return { ok: problems.length === 0, expectPromptId, rows, notOk, problems };
}

// ── CLI ────────────────────────────────────────────────────────────────────
function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = /^--([^=]+)=?(.*)$/.exec(a);
    return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
  }));
  const axis = args.axis ? String(args.axis) : '';
  if (!axis || !AXES[axis]) {
    console.error(`用法: node collect-verdicts.mjs --run=out/<runId> --axis=<axis>`);
    console.error(`      node collect-verdicts.mjs --axis=<axis> --prompt-id`);
    console.error(`axis 可选: ${Object.keys(AXES).join(' ')}`);
    process.exit(2);
  }
  const judgesDir = args.judges ? String(args.judges) : `${HERE}judges`;

  if (args['prompt-id']) { console.log(promptId(axis, judgesDir)); process.exit(0); }
  if (!args.run) { console.error('用法: node collect-verdicts.mjs --run=out/<runId> --axis=<axis>'); process.exit(2); }

  let r;
  try { r = collect({ runDir: String(args.run), axis, judgesDir }); }
  catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }

  const graded = r.rows.filter(x => x.state !== 'skipped');
  const okN = r.rows.filter(x => x.state === 'ok').length;
  const refN = graded.reduce((n, x) => n + x.nRefs, 0);
  console.log(`axis=${axis}  run=${String(args.run).replace(/\/$/, '')}  promptId=${r.expectPromptId}`);
  console.log(`要判样本 ${graded.length} · 要判条目 ${refN} · 合规判定文件 ${okN}/${graded.length}` +
    (r.rows.length - graded.length ? ` · 跳过 ${r.rows.length - graded.length} 簇(判不可写/无正文)` : ''));
  if (r.notOk.length) {
    // 契约 §2:样本失败是一等状态,不计入比例但必须列出来,不允许悄悄少一个样本
    console.log(`run.json 里非 ok 的样本 ${r.notOk.length} 个(不要求判定): ` +
      r.notOk.map(x => `c${x.cluster}=${x.status}`).join(' '));
  }

  if (r.ok) { console.log('✓ 齐全且合规'); process.exit(0); }
  // 缺文件单列一节:判官还没落盘时这是唯一要看的东西,混在问题流水里反而找不到
  const missing = r.rows.filter(x => x.state === 'missing');
  if (missing.length) {
    console.error(`\n缺判定文件 ${missing.length} 个:`);
    for (const x of missing) console.error(`  ${x.file}`);
  }
  const rest = r.problems.filter(p => p.kind !== 'missing');
  if (rest.length) {
    console.error(`\n其他问题 ${rest.length} 条:`);
    for (const p of rest) console.error(`  · ${p.msg}`);
  }
  console.error(`\n✗ 不通过 —— 这一轴的任何比例一律不采用,先把上面 ${r.problems.length} 条修完再重跑`);
  process.exit(2);
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entry === realpathSync(fileURLToPath(import.meta.url))) main();
