import type { GuardKind } from '../utils/grounded-edits';
/**
 * b′ 分段写的**纯结构逻辑**：类型、覆盖补齐、成品 markdown 渲染。
 *
 * 单独成模块，不跟调 LLM 的 BriefGenerationService 混在一起。理由不是洁癖：
 * b′ 的整个卖点是「块数与覆盖由代码保证、不问模型自觉」，那个保证就落在这个文件里，
 * 它必须能脱离 Cloudflare 运行时单独加载、单独用真实数据对拍。
 * （实测：brief-generation.ts 因为有 TS 参数属性，`node --experimental-strip-types` 加载不了。）
 */

// ============================================================================
// b′ 骨架：类型、常量与纯函数
// ============================================================================

/** 独立事态区的标题。b′ 里它不是「降级区」——每条也拿完整分析块，只是没有因果同伴。 */
export const ISOLATED_HEADING = 'standalone developments';

/**
 * 每次 LLM 调用在 trace 内的序号。R2 的调用日志按 `{phase}-{idx}` 归档，撞号会互相覆盖，
 * 而 b′ 的调用分散在多个 workflow step（多次 HTTP 请求）里、共用同一个 trace_id，
 * 没有天然的自增计数器可用——故按用途分段，用 story 下标做段内偏移。
 */
export const CALL_INDEX = {
  plan: 0,
  assembleTitle: 1,
  blockWriteBase: 100,
  blockVerifyBase: 200,
  titleFillBase: 300,
} as const;

export interface SkeletonRef {
  /** 1 基的 story 序号，与规划 prompt 里的 `[i]` 对应 */
  i: number;
  title: string;
}

export interface SkeletonSection {
  heading: string;
  causalLink: string;
  reports: SkeletonRef[];
}

export interface BriefSkeleton {
  /** 因果主线章节：每节 ≥2 份报告 */
  main: SkeletonSection[];
  /** 独立事态：规划判定只有自己一节的，以及规划漏掉、被代码补回的 */
  isolated: SkeletonRef[];
  /** 规划完全没提到、由代码补进独立事态的 story 序号。非空即说明规划步不完整。 */
  repaired: number[];
}

export interface BriefBlockResult {
  index: number;
  title: string;
  text: string;
  /** false = 这块没经过 RARR 核验（调用失败或响应坏），不是"核过且干净" */
  verified: boolean;
  edits: number;
  applied: number;
  skipped: number;
  blocked: Record<GuardKind, number>;
  blockedDetail?: unknown[];
}

/**
 * 把规划步的原始 JSON 整成 b′ 形态，并**程序化补齐覆盖**：
 * 去掉非法/重复索引 → 多报告的成主线、单报告的进独立事态 → 规划漏掉的索引也进独立事态。
 * 返回结果里 1..n 恰好各出现一次，由代码保证，不问模型自觉。
 *
 * 这是 b′ 落地率从 12%-56% 变成 100% 的关键：v1 让模型自己保证结构，实测整节忘打标记、
 * 覆盖度量数的是「计划里的报告数」而非产出的块，两轮都虚报 25/25。
 */
export function shapeSkeleton(plan: any, n: number): BriefSkeleton {
  const seen = new Set<number>();
  const clean: SkeletonSection[] = [];
  for (const s of (plan?.sections ?? []) as any[]) {
    const refs: SkeletonRef[] = (s?.reports ?? [])
      .map((r: any) =>
        typeof r === 'number'
          ? { i: r, title: '' }
          : { i: Number(r?.i), title: String(r?.title ?? '').trim() }
      )
      .filter((r: SkeletonRef) => Number.isInteger(r.i) && r.i >= 1 && r.i <= n && !seen.has(r.i));
    refs.forEach((r) => seen.add(r.i));
    if (refs.length) {
      clean.push({
        heading: String(s?.heading ?? '').trim(),
        causalLink: String(s?.causalLink ?? '').trim(),
        reports: refs,
      });
    }
  }
  const repaired = Array.from({ length: n }, (_, i) => i + 1).filter((x) => !seen.has(x));
  const main = clean.filter((s) => s.reports.length >= 2 && s.heading.length > 0);
  const isolated: SkeletonRef[] = [
    // 标题为空的节（模型没给 heading）里的报告也归独立事态：没有标题的章节渲染不出来
    ...clean.filter((s) => s.reports.length === 1 || !s.heading).flatMap((s) => s.reports),
    ...repaired.map((i) => ({ i, title: '' })),
  ].sort((a, b) => a.i - b.i);
  return { main, isolated, repaired };
}

/**
 * 宽松 JSON 解析：```json 围栏 → 裸 {…} → 整串，并容忍尾逗号。
 * 规划步与校验步的输出都靠它——parseJSONFromResponse 只认严格围栏，
 * 模型少写一个换行就整块作废。
 */
export function parseLooseJSON(raw: string): any {
  const candidates = [
    raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1],
    raw.match(/\{[\s\S]*\}/)?.[0],
    raw,
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const o = JSON.parse(c.replace(/,\s*([}\]])/g, '$1'));
      if (o && typeof o === 'object') return o;
    } catch {
      /* 下一个候选 */
    }
  }
  return null;
}

/**
 * 拼装成品简报的 markdown。**纯函数、零 LLM**——b′ 的「结构由代码保证」就落在这里：
 * `<u>**title**</u>` 包装、章节归属、章节内顺序全在这一处决定，模型无从违反。
 *
 * @param blocksByIndex 键是 0 基的报告下标；骨架里的 `i` 是 1 基，差 1
 */
export function renderBriefMarkdown(
  skeleton: BriefSkeleton,
  blocksByIndex: Map<number, { title: string; text: string }>
): { content: string; sectionCount: number } {
  const render = (ref: SkeletonRef): string | null => {
    const blk = blocksByIndex.get(ref.i - 1);
    if (!blk) return null;
    return `<u>**${blk.title || ref.title}**</u>\n${blk.text}`;
  };

  const parts: string[] = [];
  for (const s of skeleton.main) {
    const rendered = s.reports.map(render).filter((x): x is string => x !== null);
    // 整节的块全失败 → 整节不渲染（留一个空标题比少一节更糟）
    if (rendered.length) parts.push(`## ${s.heading.toLowerCase()}\n\n${rendered.join('\n\n')}`);
  }
  const iso = skeleton.isolated.map(render).filter((x): x is string => x !== null);
  if (iso.length) parts.push(`## ${ISOLATED_HEADING}\n\n${iso.join('\n\n')}`);
  return { content: parts.join('\n\n'), sectionCount: parts.length };
}

/** 只剥模型可能自作主张加的结构标记；正文非空即成功。没有格式可违反 = 没有整块作废。 */
export function toProse(raw: string): string | null {
  const text = raw
    .trim()
    .replace(/^#+\s.*$/gm, '')                // 自作主张的 ## 标题
    .replace(/^\s*<u>.*?<\/u>\s*$/gm, '')     // 自作主张的 <u> 标题行
    .replace(/\[story \d+(\/\d+)?\]/g, '')    // 泄漏的 story 标签
    .trim();
  return text ? text : null;
}

/** 补标题调用的返回值清洗：只取首行，剥掉 markdown 标记与引号 */
export function cleanTitle(raw: string): string {
  return (raw ?? '').trim().split('\n')[0].replace(/^[#*"'\s]+|[*"'\s]+$/g, '');
}

/** 限并发跑一批任务（Worker 里没有现成的并发池；标题补齐会同时发几次小调用） */
export async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const item = queue.shift();
        if (item === undefined) return;
        await fn(item);
      }
    })
  );
}

// ============================================================================
// R2 批量读取（限并发）
// ============================================================================

/** 最小 R2 形状，只用到本文件需要的两个方法——为的是能拿假 bucket 离线对拍。 */
export interface MinimalBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export interface R2LoadResult<T> {
  /** 按输入 key 的顺序；失败位留空 */
  values: T[];
  /** R2 里不存在的 key */
  missing: string[];
  /** 存在但读不出/解析不了的 key，带原因 */
  broken: string[];
}

/**
 * 限并发读一批 R2 对象并逐个解析。
 *
 * ⚠️ 「取对象 + 读 body」必须成对做完再取下一份。写成
 * `Promise.all(keys.map(k => bucket.get(k)))` 再在循环里逐个 `.text()` 会炸：
 * body 是流，没读完的连接一直开着；**Workers 同时只允许 6 条连接**，超出的被平台
 * 掐掉，随后 `.text()` 抛 `Response closed due to connection limit`。
 * 2026-08-29 21:00 b′ 首次真实 cron 即因此整期失败（25 份情报报告 → 25 条并发）。
 * 本地 miniflare 没有这个上限，`wrangler dev` 与 dry-run 全绿，照不出来。
 *
 * limit 取 4 而非 6：留出余量给同一请求里可能并存的其它出站连接。
 */
export async function loadR2Batched<T>(
  keys: string[],
  bucket: MinimalBucket,
  parse: (text: string, key: string) => T,
  limit = 4
): Promise<R2LoadResult<T>> {
  const values: T[] = new Array(keys.length);
  const missing: string[] = [];
  const broken: string[] = [];

  await mapLimit(
    keys.map((key, i) => ({ key, i })),
    limit,
    async ({ key, i }) => {
      const obj = await bucket.get(key);
      if (!obj) {
        missing.push(key);
        return;
      }
      // 读 body 与解析分开报错：读失败是连接/传输问题，解析失败是内容问题，
      // 两者修法完全不同。合在一句 catch 里会把连接数上限报成「解析失败」——
      // 上面那次生产失败就是被这条错误信息带偏了一轮。
      let text: string;
      try {
        text = await obj.text();
      } catch (e) {
        broken.push(`${key}(读取: ${e instanceof Error ? e.message : String(e)})`);
        return;
      }
      try {
        values[i] = parse(text, key);
      } catch (e) {
        broken.push(`${key}(解析: ${e instanceof Error ? e.message : String(e)})`);
      }
    }
  );

  return { values, missing, broken };
}
