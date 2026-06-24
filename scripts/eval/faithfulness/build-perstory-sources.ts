// 建 per-story 源旁车：对 gold 文件里每个 brief_id，从 backend observability 拉该 run 的
// 全部 intelligence_analysis 输出（= 运行时忠实度门逐源判的 per-story 情报报告）。
// 输出 gold/sources-perstory.jsonl，每行 {brief_id, sources: [str,...]}。
// 这是 eval 保真修复：之前用 brief_generation 整源(~84K, 系统prompt+全story拼接)，
// 与运行时 per-story(~7.5K/story 短路判)不符 → 误拦虚高。详见 ADR 0001 / memory。
// 用法：tsx build-perstory-sources.ts <gold.jsonl> [<gold.jsonl> ...]
import { readFileSync, writeFileSync } from 'node:fs';

const B = process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';
const OUT = process.env.OUT || 'gold/sources-perstory.jsonl';

async function j(url: string) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json() as any; }

async function perStorySources(wf: string): Promise<string[]> {
  const list = await j(`${B}/observability/runs/${wf}/llm-calls`);
  const ia = (list.calls || []).filter((c: any) => c.phase === 'intelligence_analysis');
  const out: string[] = [];
  for (const c of ia) {
    const raw = await j(`${B}/observability/llm-calls/${c.key}`);
    const content = raw.response?.content || '';
    if (content) out.push(content);
  }
  return out;
}

async function main() {
  const goldFiles = process.argv.slice(2);
  const briefIds = new Set<string>();
  for (const f of goldFiles) {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const o = JSON.parse(t);
      const bid = o.brief_id ?? String(o.id ?? '').split('#')[0];
      if (bid) briefIds.add(bid);
    }
  }
  console.log(`[perstory] ${briefIds.size} briefs across ${goldFiles.length} gold files`);
  const lines: string[] = [];
  for (const bid of briefIds) {
    try {
      const sources = await perStorySources(bid);
      lines.push(JSON.stringify({ brief_id: bid, sources }));
      console.log(`  ${bid}: ${sources.length} per-story sources`);
    } catch (e) {
      console.warn(`  ⚠ ${bid}: ${e instanceof Error ? e.message : e}`);
    }
  }
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`-> ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
