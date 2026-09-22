// ============================================================================
// eval 卫生断言 —— 抓「静默失真」：代码不报错、照常返回一个合理的值，但那个值是错的
// 或回答了另一个问题。
//
// 立此模块的直接原因：2026-07-15 一天之内被同一类问题坑了 5 次，每次都是【被烧到之后
// 才补上检查】，且每次的检查都得重新发明一遍：
//   1. AI Gateway 缓存 → 同 prompt 重问 n 次全命中缓存 → "3/3 vs 0/3" 真实样本量是 1 比 1
//   2. 检测器正则语序写反 → 缺陷在 3/6 基线里却报 0 命中（工具说"没问题"而问题就在那儿）
//   3. 判官的错误响应被当结果缓存 → 后续每次跑都跳过并返回 "30 claim / 0 判决"
//   4. 源"拆解再重建"时变形（双层包裹）→ 报告照常生成、数字照常打印，但答的是另一个实验
//   5. 缓存 bug 的第二化身：修了 /meridian/chat 的出口，没修服务内部调用（修门未修窗）
//
// 五次【没有一次靠报错抓到】，全靠"两个读数打架"。单一测量永远自洽——它没有任何理由
// 告诉你它错了。所以：多留一个能跟它打架的读数，并把这件事编译成代码。
// 文档里的教训要人记得，断言里的教训不需要。
//
// 定位：只【测量并报告】，由调用方决定 throw 还是 warn（对齐 metrics.ts 的克制）。
// 零依赖、零 LLM、零网络——全部确定性。
// ============================================================================

export interface HygieneIssue {
  check: string;
  severity: 'fatal' | 'warn';
  message: string;
}

// ---------------------------------------------------------------------------
// 1. 独立采样：temp>0 的模型不该给出逐字节相同的输出。相同 = 缓存没关掉，
//    n 次采样退化成 1 次，一切基于"多次"的结论（发作率/多数决/κ）全部作废。
//    踩坑实录：qwen 全线的 ai_gateway_config.cache_ttl 对 DashScope 是死配置
//    （custom provider path 绕开 enhancementService），线上缓存实为 Gateway 默认策略。
//    → 调用方须显式传 skipCache:true，且【每条调用路径都要传】(踩过第二次)。
// ---------------------------------------------------------------------------
export function checkIndependentSamples(outputs: string[], label = 'samples'): HygieneIssue[] {
  if (outputs.length < 2) return [];
  const uniq = new Set(outputs).size;
  if (uniq === 1) {
    return [{
      check: 'independent-samples',
      severity: 'fatal',
      message: `${label}: ${outputs.length} 次输出逐字节相同 → skipCache 未生效，真实样本量=1，读数不可信`,
    }];
  }
  if (uniq < outputs.length) {
    return [{
      check: 'independent-samples',
      severity: 'warn',
      message: `${label}: ${outputs.length} 次输出仅 ${uniq} 个不同值 → 疑似部分命中缓存（缓存写入异步，首几次可能抢跑）`,
    }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// 2. 往返保真：只要 eval 里存在"把 X 拆开、再重建成 X'"的环节，就必须验 X ≈ X'。
//    踩坑实录：把生产 markdown 整段塞进 Article.content，端点内部再跑一次
//    buildArticleMarkdown → 双层包裹（假标题+编造的时间戳裹住真原文）→ 该臂的源
//    既不等于对照臂、也不等于生产。全程零报错。
// ---------------------------------------------------------------------------
export function checkRoundTrip(
  original: string,
  rebuilt: string,
  opts: { normalize?: (s: string) => string; label?: string } = {}
): HygieneIssue[] {
  const norm = opts.normalize ?? ((s: string) => s.replace(/\s+/g, ' ').trim());
  const a = norm(original), b = norm(rebuilt);
  if (a === b) return [];
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
  return [{
    check: 'round-trip',
    severity: 'fatal',
    message: `${opts.label ?? 'round-trip'}: 拆解-重建后与原件不符（原 ${a.length} / 重建 ${b.length} 字符，分叉@${i}）\n` +
      `  原  : ...${a.slice(Math.max(0, i - 40), i + 50)}\n  重建: ...${b.slice(Math.max(0, i - 40), i + 50)}`,
  }];
}

// ---------------------------------------------------------------------------
// 3. 只缓存成功结果：写入条件必须比读取条件严格。读取常是 `if (cached) skip`——
//    一个错误响应若被写进缓存，就会被永久当成事实，且后续每次跑都跳过重算。
//    踩坑实录：简报生成失败→judge 回 "Invalid payload"→被当 verdict 存下→
//    此后每轮都打印 "0 claim / 0 supported" 且看起来完全正常。
// ---------------------------------------------------------------------------
export function cacheIfValid<T>(
  value: T,
  isValid: (v: T) => boolean,
  write: (v: T) => void,
  label = 'result'
): HygieneIssue[] {
  if (isValid(value)) { write(value); return []; }
  return [{
    check: 'cache-if-valid',
    severity: 'warn',
    message: `${label}: 非成功结果，拒绝写入缓存（若写入将被永久当作事实）: ${JSON.stringify(value).slice(0, 120)}`,
  }];
}

// ---------------------------------------------------------------------------
// 4. 检测器不瞎：拿【已知阳性】喂检测器，抓不到就是尺子瞎，不是缺陷消失。
//    踩坑实录：s1 的正则语序写反（要求 first→semi-final→1966，实际文本是
//    semi-final→first→1966）→ 6 份基线里 3 份含缺陷却报 0 → 差点结论成"基线未复现"。
//    手写正则当语义检测器极不可靠：本轮 10 个写错 3 个。
// ---------------------------------------------------------------------------
export function checkDetectorSees(
  detector: (text: string) => boolean,
  knownPositives: Array<{ id: string; text: string }>,
  label = 'detector'
): HygieneIssue[] {
  const missed = knownPositives.filter((p) => !detector(p.text));
  if (missed.length === 0) return [];
  return [{
    check: 'detector-sees',
    severity: 'fatal',
    message: `${label}: 抓不到 ${missed.length}/${knownPositives.length} 条已知阳性 [${missed.map((m) => m.id).join(', ')}] → 尺子瞎，先修检测器再谈读数`,
  }];
}

// ---------------------------------------------------------------------------
// 5. 零命中须人核：检测器 0 命中有两种解释——「缺陷真没复现」/「检测器瞎」。
//    这两者在输出上完全同形，不许自动结案。
// ---------------------------------------------------------------------------
export function checkZeroHitsNeedsReview(hits: number, n: number, label = 'baseline'): HygieneIssue[] {
  if (hits > 0 || n === 0) return [];
  return [{
    check: 'zero-hits-review',
    severity: 'warn',
    message: `${label}: ${n} 次采样 0 命中 → 须人核（缺陷未复现 or 检测器瞎），不许自动结案`,
  }];
}

// ---------------------------------------------------------------------------
// 6. 跨轮读数打架：同一指标在不同轮次差异过大 → 先怀疑管线，别急着解释现象。
//    踩坑实录：B 臂 0/24 与前一轮实测的 6%/11% 对不上 → 追下去是缓存 + 源变形。
//    "结果好得不合理"是线索，不是好消息。
// ---------------------------------------------------------------------------
export function checkAgainstPriorReading(
  current: number,
  prior: number,
  opts: { tolerance?: number; label?: string } = {}
): HygieneIssue[] {
  const tol = opts.tolerance ?? 0.25;
  const diff = Math.abs(current - prior);
  if (diff <= tol) return [];
  return [{
    check: 'prior-reading',
    severity: 'warn',
    message: `${opts.label ?? 'metric'}: 本轮 ${current.toFixed(3)} vs 前轮 ${prior.toFixed(3)}（差 ${diff.toFixed(3)} > 容差 ${tol}）→ 读数打架，先查管线再解释现象`,
  }];
}

// ---------------------------------------------------------------------------
// 汇总：打印 + 按需 throw。fatal 默认 throw——读数不可信时继续跑只会产出更多假数据。
// ---------------------------------------------------------------------------
export function report(issues: HygieneIssue[], opts: { throwOnFatal?: boolean } = {}): void {
  if (issues.length === 0) return;
  for (const i of issues) {
    console.log(`${i.severity === 'fatal' ? '✗ [卫生-致命]' : '⚠ [卫生-告警]'} ${i.check}: ${i.message}`);
  }
  const fatals = issues.filter((i) => i.severity === 'fatal');
  if (fatals.length && opts.throwOnFatal !== false) {
    throw new Error(`卫生检查有 ${fatals.length} 条致命项，读数不可信 → 中止（要强行继续传 throwOnFatal:false）`);
  }
}
