// 覆盖检查辅助：对给定 brief 跑新 EXTRACT_PROMPT，dump 全部抽出的 claim（不跑 judge）。
// 用法：tsx extract-dump.ts <wfId> [<wfId> ...]   输出 worklist/extract-dump.jsonl
import { writeFileSync } from 'node:fs';
import { extractClaims } from './claims.js';

const BACKEND_URL = process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'qwen-max';

async function fetchJSON(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

async function fetchBrief(wf: string): Promise<string | null> {
  const list = await fetchJSON(`${BACKEND_URL}/observability/runs/${wf}/llm-calls`);
  const bc = (list.calls || []).find((c: any) => c.phase === 'brief_generation' && c.call_index === 0);
  if (!bc) return null;
  const raw = await fetchJSON(`${BACKEND_URL}/observability/llm-calls/${bc.key}`);
  return raw.response?.content || '';
}

async function main() {
  const wfs = process.argv.slice(2);
  const out: any[] = [];
  for (const wf of wfs) {
    const brief = await fetchBrief(wf);
    if (!brief) { console.warn(`skip ${wf}`); continue; }
    const claims = await extractClaims(brief, JUDGE_MODEL);
    claims.forEach((c) => out.push({ id: `${wf}#${c.id}`, text: c.text }));
    console.log(`${wf}: ${claims.length} claims`);
  }
  writeFileSync('worklist/extract-dump.jsonl', out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  console.log(`total ${out.length} -> worklist/extract-dump.jsonl`);
}
main().catch((e) => { console.error(e); process.exit(1); });
