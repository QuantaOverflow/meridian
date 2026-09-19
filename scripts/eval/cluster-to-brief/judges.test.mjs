/**
 * 判官协议的自测:两个闸各自的**失败**路径,以及一条反向对照(齐全时必须放行)。
 *
 * 为什么用子进程跑而不是直接调函数:这两个脚本对外的契约就是**退出码**
 * ——「判官自报完成不算完成,退出码才算」。只测内部函数会测到接线,测不到这件事。
 * 伪造产物全写进 mkdtemp 的临时目录:自测绝不能碰真的 out/ 与 gold/,
 * 一个会覆盖真基准的自测比没有自测更危险。
 *
 * 跑法: node judges.test.mjs   (期望 exit 0)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promptId, refsOf } from './collect-verdicts.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const COLLECT = `${HERE}collect-verdicts.mjs`;
const ALIGN = `${HERE}judge-alignment.mjs`;

const TMP = mkdtempSync(join(tmpdir(), 'ctb-judges-test-'));
const J = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2));
const run = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

// ── 伪造一个 run:c7 有 7 句,c8 判不可写(无正文、不该被要求判定),c9 是失败样本 ──────────
const RUN = join(TMP, 'run1');
mkdirSync(join(RUN, 'verdicts'), { recursive: true });
const sent = t => ({ text: t, sources: [{ articleId: 1001, sentence: 1, quote: t }] });
const brief7 = {
  cluster: 7,
  verdict: 'written',
  blocks: [
    { title: 'B1', sentences: [sent('S one.'), sent('S two.'), sent('S three.'), sent('S four.')] },
    { title: 'B2', sentences: [sent('S five.'), sent('S six.'), sent('S seven.')] },
  ],
};
J(join(RUN, 'c7.json'), brief7);
J(join(RUN, 'c8.json'), { cluster: 8, verdict: 'not_a_single_event', reason: '题材袋', blocks: [] });
J(join(RUN, 'run.json'), {
  runId: 'selftest@fake#1', dataset: 'fake', solver: 'selftest', epoch: 1, configHash: 'sha256:0', config: {},
  samples: { 7: { status: 'ok' }, 8: { status: 'ok' }, 9: { status: 'error', error: 'boom' } },
});

const REFS = refsOf(brief7);
assert.deepEqual(REFS, ['b1s1', 'b1s2', 'b1s3', 'b1s4', 'b2s1', 'b2s2', 'b2s3']);

const AXIS = 'citation-support';
const PID = promptId(AXIS);
assert.match(PID, /^[0-9a-f]{10}$/);
// 指纹必须从内容算:同一份规格文件两次算出同一个值,改一个字就换值
assert.equal(PID, promptId(AXIS));

const vFile = join(RUN, 'verdicts', `${AXIS}-c7.json`);
const verdict = (refs, over = {}) => ({
  axis: AXIS, cluster: 7, runId: 'selftest@fake#1', promptId: PID,
  judgements: refs.map(r => ({ ref: r, label: 'pass' })),
  packDefects: [],
  ...over,
});

// ── ① 文件不在 —— 2026-09-20 那个自报「done」却没落盘的判官 ────────────────────────
{
  const r = run(COLLECT, [`--run=${RUN}`, `--axis=${AXIS}`]);
  assert.equal(r.code, 2);
  assert.match(r.all, /缺判定文件 1 个/);
  assert.match(r.all, new RegExp(`${AXIS}-c7\\.json`));
  assert.doesNotMatch(r.all, /c8/, 'c8 判不可写,不该被要求判定');
  assert.match(r.all, /c9=error/, '失败样本必须列出来,不允许悄悄少一个');
}

// ── ② 齐全合规 —— 反向对照:门修好了也要能放行 ─────────────────────────────────────
{
  J(vFile, verdict(REFS));
  const r = run(COLLECT, [`--run=${RUN}`, `--axis=${AXIS}`]);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /✓ 齐全且合规/);
  assert.match(r.out, /要判条目 7/);
  assert.match(r.out, /跳过 1 簇/);
}

// ── ③ schema 违规:label 不是二元 / fail 缺 reason / 同一 ref 判两次 ──────────────
{
  J(vFile, verdict(REFS, { judgements: REFS.map((r, i) => ({ ref: r, label: i === 0 ? 'unsure' : 'pass' })) }));
  let r = run(COLLECT, [`--run=${RUN}`, `--axis=${AXIS}`]);
  assert.equal(r.code, 2);
  assert.match(r.all, /label 必须是 pass\/fail/);

  J(vFile, verdict(REFS, { judgements: REFS.map((x, i) => (i === 0 ? { ref: x, label: 'fail' } : { ref: x, label: 'pass' })) }));
  r = run(COLLECT, [`--run=${RUN}`, `--axis=${AXIS}`]);
  assert.equal(r.code, 2);
  assert.match(r.all, /label=fail 必须给 reason/);

  J(vFile, verdict([...REFS, 'b1s1']));
  r = run(COLLECT, [`--run=${RUN}`, `--axis=${AXIS}`]);
  assert.equal(r.code, 2);
  assert.match(r.all, /b1s1 判了两次/);
}

// ── ④ 覆盖有缺口:漏一句会让分母悄悄缩小 ───────────────────────────────────────────
{
  J(vFile, verdict(REFS.filter(r => r !== 'b2s3')));
  const r = run(COLLECT, [`--run=${RUN}`, `--axis=${AXIS}`]);
  assert.equal(r.code, 2);
  assert.match(r.all, /漏判 1 条: b2s3/);

  J(vFile, verdict([...REFS, 'b9s9']));
  const r2 = run(COLLECT, [`--run=${RUN}`, `--axis=${AXIS}`]);
  assert.equal(r2.code, 2);
  assert.match(r2.all, /成稿里没有这些 ref: b9s9/);
}

// ── ⑤ promptId 过期:规格改了,这批判定是另一把尺量的 ──────────────────────────────
{
  J(vFile, verdict(REFS, { promptId: 'deadbeef00' }));
  const r = run(COLLECT, [`--run=${RUN}`, `--axis=${AXIS}`]);
  assert.equal(r.code, 2);
  assert.match(r.all, /promptId 过期/);
  assert.match(r.all, /deadbeef00/);

  const { promptId: _drop, ...noPid } = verdict(REFS);
  J(vFile, noPid);
  const r2 = run(COLLECT, [`--run=${RUN}`, `--axis=${AXIS}`]);
  assert.equal(r2.code, 2);
  assert.match(r2.all, /promptId 缺失/);
}

// ── ⑥ 整篇一条的轴:ref 只能是 brief ─────────────────────────────────────────────
{
  const ax = 'event-mixing';
  const f = join(RUN, 'verdicts', `${ax}-c7.json`);
  const pid = promptId(ax);
  J(f, { axis: ax, cluster: 7, runId: 'selftest@fake#1', promptId: pid, judgements: [{ ref: 'brief', label: 'pass' }] });
  let r = run(COLLECT, [`--run=${RUN}`, `--axis=${ax}`]);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /要判条目 1/);

  J(f, { axis: ax, cluster: 7, runId: 'selftest@fake#1', promptId: pid, judgements: [{ ref: 'b1s1', label: 'pass' }] });
  r = run(COLLECT, [`--run=${RUN}`, `--axis=${ax}`]);
  assert.equal(r.code, 2);
  assert.match(r.all, /漏判 1 条: brief/);
  assert.match(r.all, /成稿里没有这些 ref: b1s1/);
  rmSync(f);
}

// ── ⑦ --prompt-id:派判官时抄给它的那个值 ────────────────────────────────────────
{
  const r = run(COLLECT, [`--axis=${AXIS}`, '--prompt-id']);
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), PID);
}

// ── ⑧ 对齐:手搭的混淆矩阵 TP2/FN1/FP1/TN3,外加一条判官没判的金标 ────────────────
const GOLD_SMALL = join(TMP, 'gold-small.json');
{
  const judgeLabels = {
    b1s1: ['fail', '被引句没有「首次」'], b1s2: ['fail', '数字要靠别篇补'],
    b1s3: ['pass', ''], b1s4: ['fail', '这条判官报错但人工认为有据'],
    b2s1: ['pass', ''], b2s2: ['pass', ''], b2s3: ['pass', ''],
  };
  J(vFile, verdict(REFS, {
    judgements: REFS.map(r => ({ ref: r, label: judgeLabels[r][0], ...(judgeLabels[r][1] ? { reason: judgeLabels[r][1] } : {}) })),
  }));
  assert.equal(run(COLLECT, [`--run=${RUN}`, `--axis=${AXIS}`]).code, 0);

  const goldLabels = { b1s1: 'fail', b1s2: 'fail', b1s3: 'fail', b1s4: 'pass', b2s1: 'pass', b2s2: 'pass', b2s3: 'pass' };
  J(GOLD_SMALL, {
    axis: AXIS,
    labels: [
      ...REFS.map(r => ({ cluster: 7, run: 1, ref: r, label: goldLabels[r], note: `人工:${r}` })),
      { cluster: 8, run: 1, ref: 'b1s1', label: 'fail', note: '判官没判到这条' },
    ],
  });

  const r = run(ALIGN, [`--axis=${AXIS}`, `--run=${RUN}`, `--gold=${GOLD_SMALL}`]);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /TP\s+2\s+FN\s+1/);
  assert.match(r.out, /FP\s+1\s+TN\s+3/);
  assert.match(r.out, /真阳率 TPR = 2\/3 = 0\.667/);
  assert.match(r.out, /真阴率 TNR = 3\/4 = 0\.750/);
  assert.match(r.out, /分歧 2 条/);
  assert.match(r.out, /c7 b1s3\s+人工 fail \/ 判官 pass/);
  assert.match(r.out, /判官未给理由/);                                  // FN 那条判官没写理由
  assert.match(r.out, /这条判官报错但人工认为有据/);                      // FP 那条把判官理由打出来给人复核
  assert.match(r.out, /金标有标注、判官没判 1 条/);                       // 会悄悄缩小分母,必须逐条列
  assert.match(r.out, /c8\|b1s1/);
  assert.match(r.out, /epoch=1/);
  assert.match(r.out, /⚠️ 金标只有 8 条\(< 30\)/);
}

// ── ⑨ 反向对照:金标 ≥30 条时不该再打小样本警告 ───────────────────────────────────
{
  const RUN2 = join(TMP, 'run2');                                       // 无 run.json —— 顺带走一遍扫 c<N>.json 的退化路径
  mkdirSync(join(RUN2, 'verdicts'), { recursive: true });
  const many = Array.from({ length: 30 }, (_, i) => sent(`Sentence ${i + 1}.`));
  J(join(RUN2, 'c10.json'), { cluster: 10, verdict: 'written', blocks: [{ title: 'B1', sentences: many }] });
  const refs2 = many.map((_, i) => `b1s${i + 1}`);
  J(join(RUN2, 'verdicts', `${AXIS}-c10.json`), {
    axis: AXIS, cluster: 10, runId: 'selftest@fake#2', promptId: PID,
    judgements: refs2.map(r => ({ ref: r, label: 'pass' })), packDefects: [],
  });
  assert.equal(run(COLLECT, [`--run=${RUN2}`, `--axis=${AXIS}`]).code, 0);

  const gold2 = join(TMP, 'gold-30.json');
  J(gold2, { axis: AXIS, labels: refs2.map(r => ({ cluster: 10, ref: r, label: 'pass', note: '随机抽样' })) });
  const r = run(ALIGN, [`--axis=${AXIS}`, `--run=${RUN2}`, `--gold=${gold2}`]);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /真阴率 TNR = 30\/30 = 1\.000/);
  assert.match(r.out, /真阳率 TPR = 0\/0 = n\/a\(金标里没有这一类\)/);   // 分母为 0 给 n/a,不给 0
  assert.match(r.out, /分歧 0 条/);
  assert.doesNotMatch(r.out, /⚠️ 金标只有/);
  assert.match(r.out, /epoch=未知/);
}

// ── ⑩ 环境问题:缺金标 / 金标与判定无重叠 ─────────────────────────────────────────
{
  let r = run(ALIGN, [`--axis=${AXIS}`, `--run=${RUN}`, `--gold=${join(TMP, 'nope.json')}`]);
  assert.equal(r.code, 2);
  assert.match(r.all, /缺人工标注/);

  const goldOther = join(TMP, 'gold-nomatch.json');
  J(goldOther, { axis: AXIS, labels: [{ cluster: 99, ref: 'b1s1', label: 'fail', note: '别的簇' }] });
  r = run(ALIGN, [`--axis=${AXIS}`, `--run=${RUN}`, `--gold=${goldOther}`]);
  assert.equal(r.code, 2);
  assert.match(r.all, /没有一条重叠/);

  r = run(COLLECT, ['--run=/nonexistent-run-dir', `--axis=${AXIS}`]);
  assert.equal(r.code, 2);
  assert.match(r.all, /run 目录不存在/);

  r = run(COLLECT, [`--run=${RUN}`, '--axis=not-an-axis']);
  assert.equal(r.code, 2);
  assert.match(r.all, /axis 可选/);
}

// ── 六份规格文件都在,且都带着那三条硬规矩与分界说明 ────────────────────────────────
{
  const axes = ['citation-support', 'invented-fact', 'invented-relation', 'actor-swap', 'strength-distortion', 'event-mixing'];
  for (const a of axes) {
    const f = `${HERE}judges/${a}.md`;
    assert(existsSync(f), `缺规格文件 ${f}`);
    assert.match(promptId(a), /^[0-9a-f]{10}$/);
  }
  assert.equal(new Set(axes.map(a => promptId(a))).size, axes.length, '六份规格的指纹必须互不相同');
}

rmSync(TMP, { recursive: true, force: true });
console.log(`ok: collect-verdicts 拦住缺文件/schema/漏判/过期指纹并在齐全时放行;judge-alignment 在手搭矩阵上 TPR=2/3 TNR=3/4、小金标告警、≥30 条不告警`);
