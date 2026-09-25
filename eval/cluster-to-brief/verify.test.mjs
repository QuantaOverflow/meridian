/**
 * verify.mjs 的自测 —— 跑法:`node verify.test.mjs`(零依赖,零 LLM,不碰网络)。
 *
 * 为什么要有它:快档 verifier 是所有臂的尺。尺自己坏了不会报错,只会**静默给出好看的读数**
 * ——2026-09-20 之前就出过一次:判据写成「必须拆 ≥2 块」,链路改成一簇一块后它对每个臂都判不过,
 * 谁也说不清是臂坏了还是尺坏了。所以每条判据都要有一个「必须抓到」和一个「必须放过」的例子。
 *
 * 全部 fixture 在临时目录里现造(CTB_WORKSPACE 指过去),**不依赖真实簇、不依赖 out/ 里的历史产物**:
 * 真实簇的读数会随标注和抓取变,拿它当自测基线等于把尺绑在数据上。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = new URL('.', import.meta.url).pathname;
const WS = mkdtempSync(join(tmpdir(), 'ctb-verify-test-'));

// ── 合成 fixture ────────────────────────────────────────────────────────
// 5 篇文章:101/102 是事件 Alpha,201/202 是事件 Bravo,301 未入组(单篇事件或杂质)。
// 每篇 3 句(切句规则见 lib.mjs:句末标点 + 后接大写字母才切,所以最后一句不会被切开)。
const ARTICLES = {
  101: 'Alpha reactor went offline on Monday. Officials said the shutdown was planned. Local residents reported no damage.',
  102: 'The Alpha reactor outage lasted six hours. Engineers restarted the unit overnight. Output returned to normal levels.',
  201: 'Bravo airport closed after a drone sighting. Flights were diverted to a nearby city. The airport reopened at dawn.',
  202: 'Bravo airport handled the disruption calmly. Passengers waited in the terminal overnight. No injuries were reported.',
  301: 'An unrelated ferry strike began in the south. Commuters found other routes. The union promised talks.',
};
mkdirSync(join(WS, 'fixtures', 'content'), { recursive: true });
const meta = {};
for (const [id, text] of Object.entries(ARTICLES)) {
  writeFileSync(join(WS, 'fixtures', 'content', `${id}.txt`), text);
  meta[id] = { title: `article ${id}`, url: `https://example.test/${id}`, publishDate: `2026-09-1${id[0]}T00:00:00Z`, sourceId: 1 };
}
writeFileSync(join(WS, 'fixtures', 'meta.json'), JSON.stringify(meta));
writeFileSync(join(WS, 'fixtures', 'clusters.json'), JSON.stringify({ 900: [101, 102, 201, 202, 301] }));
writeFileSync(join(WS, 'expectations.json'), JSON.stringify({
  meta: { source: '合成 fixture,只给 verify.test.mjs 用' },
  clusters: {
    900: {
      name: 'synthetic', articles: 5, split: 'dev', form: 'synthetic-two-event',
      impurities: [],
      eventGroups: { Alpha: [101, 102], Bravo: [201, 202] },
      pass: { fatalErrors: 0 },
    },
  },
}));

// 两条通过线:default 照抄生产默认(900 簇没有专门阈值 → 不设句数下限);
// strict 只改两个数,用来证明**同一份读数**能被 policy 判出不同结果。
const POLICY_DEFAULT = JSON.parse(readFileSync(join(HERE, 'policy.json'), 'utf8'));
writeFileSync(join(WS, 'policy-default.json'), JSON.stringify(POLICY_DEFAULT));
const strict = structuredClone(POLICY_DEFAULT);
strict.policyVersion = 'test-strict';
strict.thresholds.clusters['900'] = { minSentences: 3 };
writeFileSync(join(WS, 'policy-strict.json'), JSON.stringify(strict));
const lenient = structuredClone(POLICY_DEFAULT);
lenient.policyVersion = 'test-lenient';
lenient.checks.noEventMixing.gate = false;   // 只报不拦
writeFileSync(join(WS, 'policy-lenient.json'), JSON.stringify(lenient));

// ── 跑 verifier ─────────────────────────────────────────────────────────
let armSeq = 0;
function run(brief, { policy = 'policy-default.json' } = {}) {
  const arm = join(WS, 'out', `arm${++armSeq}`);
  mkdirSync(arm, { recursive: true });
  writeFileSync(join(arm, 'c900.json'), JSON.stringify(brief));
  const r = spawnSync(process.execPath, [join(HERE, 'verify.mjs'), `--arm=${arm}`, '--split=all', `--policy=${join(WS, policy)}`],
    { env: { ...process.env, CTB_WORKSPACE: WS }, encoding: 'utf8' });
  const readings = JSON.parse(readFileSync(join(WS, 'out', `verify-arm${armSeq}-all.json`), 'utf8'));
  return { code: r.status, out: `${r.stdout}${r.stderr}`, read: readings.results['900'].read, res: readings.results['900'] };
}
const S = (text, sources) => ({ text, sources });
const written = (...blocks) => ({ cluster: 900, verdict: 'written', blocks });

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

// ── 1. noEventMixing:一块引两个事件 → 不合格 ────────────────────────────
test('一块引两个事件组 → noEventMixing 不合格', () => {
  const r = run(written({
    title: 'Alpha outage and Bravo airport',
    sentences: [
      S('The Alpha reactor went offline on Monday.', [{ articleId: 101, sentence: 1 }]),
      S('Bravo airport closed after a drone sighting.', [{ articleId: 201, sentence: 1 }]),
    ],
  }));
  assert.equal(r.code, 1, `应因跨事件不合格,实际 exit=${r.code}\n${r.out}`);
  assert.equal(r.read.eventMixingStatus, 'mixed');
  assert.equal(r.read.mixedBlocks, 1);
  assert.match(r.out, /跨 2 个事件/);
  assert.match(r.out, /\[不合格\].*跨事件/);
});

// ── 2. 一块只引一个事件 → 合格(架构中立:一簇一块也能过)────────────────
test('一块只引一个事件组 → 合格', () => {
  const r = run(written({
    title: 'Alpha reactor outage',
    sentences: [
      S('The Alpha reactor went offline on Monday.', [{ articleId: 101, sentence: 1 }]),
      S('Engineers restarted the unit overnight.', [{ articleId: 102, sentence: 2 }]),
    ],
  }));
  assert.equal(r.code, 0, `应合格,实际 exit=${r.code}\n${r.out}`);
  assert.equal(r.read.eventMixingStatus, 'ok');
  assert.equal(r.read.singleEvent, 'Alpha');   // 旧键仍在(保留一个版本)
});

// ── 2b. 多块、各自一个事件 → 合格(旧的多块臂仍可比)──────────────────────
test('两块各引一个事件组 → 合格', () => {
  const r = run(written(
    { title: 'Alpha reactor outage', sentences: [S('The Alpha reactor went offline on Monday.', [{ articleId: 101, sentence: 1 }])] },
    { title: 'Bravo airport closure', sentences: [S('Bravo airport closed after a drone sighting.', [{ articleId: 201, sentence: 1 }])] },
  ));
  assert.equal(r.code, 0, `应合格,实际 exit=${r.code}\n${r.out}`);
  assert.equal(r.read.eventMixingStatus, 'ok');
  assert.deepEqual(r.read.blockEventGroups, ['Alpha', 'Bravo']);
});

// ── 2c. 引到未入组文章 → 不合格(严格:宁可误拒不误放)────────────────────
test('一块混入未入组文章 → 不合格', () => {
  const r = run(written({
    title: 'Alpha outage plus a ferry strike',
    sentences: [
      S('The Alpha reactor went offline on Monday.', [{ articleId: 101, sentence: 1 }]),
      S('An unrelated ferry strike began in the south.', [{ articleId: 301, sentence: 1 }]),
    ],
  }));
  assert.equal(r.code, 1, `应不合格,实际 exit=${r.code}\n${r.out}`);
  assert.match(r.out, /未入组文章 \[301\]/);
});

// ── 3. 判不可写 → 合格 ──────────────────────────────────────────────────
test('verdict=not_a_single_event → 合格', () => {
  const r = run({ cluster: 900, verdict: 'not_a_single_event', reason: '两件不相干的事,不能写成一条', blocks: [] });
  assert.equal(r.code, 0, `应合格,实际 exit=${r.code}\n${r.out}`);
  assert.equal(r.read.eventMixingStatus, 'rejected');
});

// ── 4. 句子截断 → 不合格 ────────────────────────────────────────────────
test('句末无标点(截断)→ 不合格,且实例出现在报告里', () => {
  const r = run(written({
    title: 'Alpha reactor outage',
    sentences: [
      S('Officials said the shutdown was planned but the reactor outage lasted six hours', [{ articleId: 101, sentence: 2 }]),
      S('官方称机组已恢复正常出力。', [{ articleId: 102, sentence: 3 }]),   // 中文句号同样算句末,不许误判成截断
    ],
  }));
  assert.equal(r.code, 1, `应因截断不合格,实际 exit=${r.code}\n${r.out}`);
  assert.equal(r.read.truncatedSentences, 1, '只有第一句是截断,中文句号那句不算');
  assert.match(r.out, /没有句末标点/);
  assert.match(r.out, /outage lasted six hours/);
});

test('真实案例:句子停在 "criticized the idea as " → 不合格', () => {
  const r = run(written({
    title: 'Alpha reactor outage',
    sentences: [S('US President Donald Trump criticized the idea as ', [{ articleId: 101, sentence: 2 }])],
  }));
  assert.equal(r.code, 1);
  assert.equal(r.read.truncatedSentences, 1);
});

// ── 7. 通过线搬到 policy 之后,同一份读数能被判成不同结果 ────────────────
test('policy 的句数下限决定过不过,读数一字不变', () => {
  const brief = written({
    title: 'Alpha reactor outage',
    sentences: [
      S('The Alpha reactor went offline on Monday.', [{ articleId: 101, sentence: 1 }]),
      S('Engineers restarted the unit overnight.', [{ articleId: 102, sentence: 2 }]),
    ],
  });
  const loose = run(brief, { policy: 'policy-default.json' });
  const tight = run(brief, { policy: 'policy-strict.json' });
  assert.equal(loose.code, 0, `默认线应合格\n${loose.out}`);
  assert.equal(tight.code, 1, `句数下限 3 应不合格\n${tight.out}`);
  assert.match(tight.out, /低于下限 3/);
  assert.deepEqual(tight.read, loose.read, '两次判定的读数必须完全一致 —— 事实不随通过线变');
});

test('policy 把 noEventMixing 改成只报不拦 → 同一份跨事件输出变合格,读数照旧记录', () => {
  const brief = written({
    title: 'Alpha outage and Bravo airport',
    sentences: [
      S('The Alpha reactor went offline on Monday.', [{ articleId: 101, sentence: 1 }]),
      S('Bravo airport closed after a drone sighting.', [{ articleId: 201, sentence: 1 }]),
    ],
  });
  const gated = run(brief, { policy: 'policy-default.json' });
  const off = run(brief, { policy: 'policy-lenient.json' });
  assert.equal(gated.code, 1);
  assert.equal(off.code, 0, `gate=false 时不该拦\n${off.out}`);
  assert.equal(off.read.eventMixingStatus, 'mixed', '不设门也要照样记录事实');
  assert.equal(off.read.mixedBlocks, 1);
  assert.match(off.out, /\[读数\].*跨事件/);
});

// ── 环境问题与质量问题必须分开(exit 2 vs exit 1)────────────────────────
test('缺 reason 的 not_a_single_event 是环境/schema 问题 → exit 2', () => {
  const r = run({ cluster: 900, verdict: 'not_a_single_event', blocks: [] });
  assert.equal(r.code, 2, `schema 问题应 exit 2,实际 ${r.code}\n${r.out}`);
});

// ── 跑 ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}
rmSync(WS, { recursive: true, force: true });
console.log(failed ? `\n${failed}/${cases.length} 条自测失败` : `\n${cases.length}/${cases.length} 条自测通过`);
process.exit(failed ? 1 : 0);
