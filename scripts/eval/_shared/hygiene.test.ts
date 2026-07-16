// 确定性自测(不碰 LLM):每条断言用 2026-07-15 的【真实踩坑场景】当测试向量,不用编的例子。
// 跑法(_shared 无自身 package.json,借任一 harness 的 tsx,与 metrics.test.ts 同):
//   cd scripts/eval/intel-grounding && npx tsx ../_shared/hygiene.test.ts
import {
  checkIndependentSamples, checkRoundTrip, cacheIfValid, checkDetectorSees,
  checkZeroHitsNeedsReview, checkAgainstPriorReading, report, type HygieneIssue,
} from './hygiene.js';

let failures = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name} ${detail}`); }
}
const sev = (is: HygieneIssue[]) => is.map((i) => i.severity).join(',');

console.log('checkIndependentSamples —— 真实场景:qwen-long 重问 4 次全命中 Gateway 缓存');
{
  // 实录:B 臂 4 次输出长度 [1778,1778,1778,1778] 逐字节相同
  const cached = ['x'.repeat(1778), 'x'.repeat(1778), 'x'.repeat(1778), 'x'.repeat(1778)];
  ok('全同 → fatal', sev(checkIndependentSamples(cached)) === 'fatal');
  // 实录:A 臂 4 次长度 [3484,3122,3554,3512] 各不相同 = 真独立采样
  ok('全异 → 无问题', checkIndependentSamples(['a', 'b', 'c', 'd']).length === 0);
  // 实录:首轮 baseline run0 独立、run1/run2 命中缓存(缓存写入异步致首次抢跑)
  ok('部分重复 → warn', sev(checkIndependentSamples(['a', 'b', 'b'])) === 'warn');
  ok('单样本不判', checkIndependentSamples(['a']).length === 0);
}

console.log('\ncheckRoundTrip —— 真实场景:Article[] 拆解后经 buildArticleMarkdown 重建');
{
  ok('一致 → 无问题', checkRoundTrip('## [T](u)\n\n> 2026-07-11\n\n正文', '## [T](u)\n> 2026-07-11\n正文').length === 0,
    '(默认 normalize 折叠空白)');
  // 实录:整段塞进 content → 双层包裹(假标题 a0 裹住真标题)
  const orig = '## [真标题](真url)\n正文';
  const bad = '## [a0](https://e.com/0)\n```\n## [真标题](真url)\n正文\n```';
  ok('双层包裹 → fatal', sev(checkRoundTrip(orig, bad)) === 'fatal');
  ok('自定义 normalize 生效', checkRoundTrip('A-B', 'A—B', { normalize: (s) => s.replace(/[—-]/g, '-') }).length === 0);
}

console.log('\ncacheIfValid —— 真实场景:judge 回 "Invalid payload" 被当 verdict 存下');
{
  let stored: any = null;
  const good = { total_claims: 30, supported: 28 };
  ok('成功结果 → 写入', cacheIfValid(good, (v: any) => typeof v?.total_claims === 'number', (v) => { stored = v; }).length === 0 && stored === good);
  stored = null;
  // 实录:{success:false, error:'Invalid payload: brief: Required'}
  const bad = { success: false, error: 'Invalid payload: brief: Required' };
  const is = cacheIfValid(bad, (v: any) => typeof v?.total_claims === 'number', (v) => { stored = v; });
  ok('错误响应 → 拒写 + warn', sev(is) === 'warn' && stored === null);
}

console.log('\ncheckDetectorSees —— 真实场景:s1 正则语序写反,缺陷在却报 0');
{
  const real = 'advancing to the semifinals for the first time since 1966';
  const bad = (t: string) => /first[^.]{0,40}semi-?finals?[^.]{0,50}since\s+1966/i.test(t);  // 语序反,抓不到
  const good = (t: string) => /semi-?finals?[^.]{0,60}first[^.]{0,50}since\s+1966/i.test(t); // 修正版
  ok('瞎检测器 → fatal', sev(checkDetectorSees(bad, [{ id: 's1', text: real }])) === 'fatal');
  ok('好检测器 → 无问题', checkDetectorSees(good, [{ id: 's1', text: real }]).length === 0);
}

console.log('\ncheckZeroHitsNeedsReview / checkAgainstPriorReading');
{
  ok('0 命中 → warn 须人核', sev(checkZeroHitsNeedsReview(0, 6)) === 'warn');
  ok('有命中 → 无问题', checkZeroHitsNeedsReview(3, 6).length === 0);
  ok('n=0 不判', checkZeroHitsNeedsReview(0, 0).length === 0);
  // 实录:B 臂 0.0 vs 前轮 0.06 在容差内;而 0/24 vs 25% 这种才该报
  ok('小差异 → 无问题', checkAgainstPriorReading(0.0, 0.06).length === 0);
  ok('大差异 → warn', sev(checkAgainstPriorReading(0.0, 0.56)) === 'warn');
}

console.log('\nreport');
{
  let threw = false;
  try { report([{ check: 'c', severity: 'fatal', message: 'm' }]); } catch { threw = true; }
  ok('fatal 默认 throw', threw);
  threw = false;
  try { report([{ check: 'c', severity: 'fatal', message: 'm' }], { throwOnFatal: false }); } catch { threw = true; }
  ok('throwOnFatal:false 不 throw', !threw);
  threw = false;
  try { report([{ check: 'c', severity: 'warn', message: 'm' }]); } catch { threw = true; }
  ok('warn 不 throw', !threw);
  ok('空列表静默', (() => { report([]); return true; })());
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 条失败`);
process.exit(failures === 0 ? 0 : 1);
