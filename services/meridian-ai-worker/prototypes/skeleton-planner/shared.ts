/**
 * b′ 臂的公共件：fixtures 加载、情报报告渲染、chat 封装、度量。
 *
 * 注：`anchor-ab.ts` 里有一份同样的 body()/chat()。那是已出结论的定稿实验（A/B/C/D 四臂），
 * 不动它，避免改坏已经产出结果的代码。新东西一律从这里走。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBriefGenerationPrompt } from '../../src/prompts/briefGeneration.ts';

export const here = dirname(fileURLToPath(import.meta.url));
export const AI = process.env.AI_WORKER_URL ?? 'https://meridian-ai-worker.swj299792458.workers.dev';

/** 第 75 期的 25 份真实情报报告（从 R2 拉的），按重要性序 */
export const reports: any[] = readdirSync(join(here, 'fixtures/intel-75'))
  .filter((f) => f.endsWith('.json'))
  .sort((a, b) => Number(a.split('.')[0]) - Number(b.split('.')[0]))
  .map((f) => JSON.parse(readFileSync(join(here, 'fixtures/intel-75', f), 'utf8')));

/** 复刻生产 convertReportsToMarkdown 的主要区块 */
export function body(r: any): string {
  let s = '';
  const tl = r.timeline;
  if (Array.isArray(tl) && tl.length) {
    s += '## 时间线（事件按此时间戳顺序发生，叙述时序/因果必须与此一致，不得重排）\n';
    tl.forEach((e: any) => { const ts = e.timestamp || e.date || ''; s += ts ? `* [${ts}] ${e.description}\n` : `* ${e.description}\n`; });
    s += '\n';
  }
  if (r.factualBasis?.length) {
    s += '## 关键发展\n';
    r.factualBasis.forEach((f: any) => { s += `* ${typeof f === 'string' ? f : JSON.stringify(f)}\n`; });
    s += '\n';
  }
  const ents = r.entities?.length ? r.entities : r.keyEntities;
  if (Array.isArray(ents) && ents.length) {
    s += '## 相关方（角色与言行须严格对应，勿张冠李戴）\n';
    ents.forEach((e: any) => { s += `* ${e.name}${e.role || e.type ? ` (${e.role || e.type})` : ''}${e.description ? `：${e.description}` : ''}\n`; });
    s += '\n';
  }
  if (r.significance) s += `## 意义\n${typeof r.significance === 'string' ? r.significance : JSON.stringify(r.significance)}\n\n`;
  return s;
}

/**
 * 从生产 prompt 里**运行时切出**接地规则（rule 0 / 0b / 0c），不复制。
 * 分段写的每一次调用都得带上这段，否则丢的就是「不许编造 / 不许重排时间线 / 逐字抄数字」。
 * 生产 prompt 一改，这里自动跟着变——切片失败就抛，不静默降级成没有接地规则。
 */
export function groundingRules(): string {
  const full = getBriefGenerationPrompt('__PLACEHOLDER__', '');
  const from = full.indexOf('0. **FACTUAL GROUNDING');
  const to = full.indexOf('1. **MANDATORY ANALYTICAL DEPTH**');
  if (from < 0 || to < 0 || to <= from) throw new Error('接地规则切片失败——生产 prompt 的锚点变了，改这里');
  return full.slice(from, to).trim();
}

/**
 * 一次调用带 3 次重试。*.workers.dev 在本机会随机 `fetch failed` / 挂起数十秒
 * （见交接文档「坑 2」），而分段写一份简报要打 14 次——不重试的话单点抖动就毁掉整轮。
 * 空正文也算失败重试：拿到 200 但 content 为空，往下走会静默变成「这块没写」。
 */
export async function chat(prompt: string, temp: number, maxTokens: number, tries = 3): Promise<string> {
  let last: unknown;
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(`${AI}/meridian/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          options: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: temp, max_tokens: maxTokens, skipCache: true },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const j: any = await res.json();
      if (!res.ok || j?.success === false) throw new Error(j?.error ?? `HTTP ${res.status}`);
      const c = j?.data?.choices?.[0]?.message?.content ?? '';
      if (!c.trim()) throw new Error('空正文');
      return c;
    } catch (e) {
      last = e;
      process.stderr.write(`  [retry ${a}/${tries}] ${e instanceof Error ? e.message : String(e)}\n`);
      if (a < tries) await new Promise((r) => setTimeout(r, 2000 * a));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** 限并发跑一批任务，结果按原序返回；失败的位置留 null（调用方必须自己看 null，别当成功） */
export async function pool<T, R>(items: T[], conc: number, fn: (t: T, i: number) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  const q = items.map((t, i) => ({ t, i }));
  await Promise.all(Array.from({ length: conc }, async () => {
    for (;;) {
      const j = q.shift(); if (!j) return;
      try { out[j.i] = await fn(j.t, j.i); } catch (e) { process.stderr.write(`\n[fail #${j.i}] ${e instanceof Error ? e.message : String(e)}\n`); }
    }
  }));
  return out;
}

export function measure(brief: string) {
  const heads = [...brief.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  const main = heads.filter((h) => !/noteworthy/i.test(h));
  return { sections: main.length, blocks: (brief.match(/<u>/g) ?? []).length, chars: brief.length, headings: main };
}
