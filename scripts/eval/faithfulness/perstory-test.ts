// 治②实验：对"整份源误拦"的 claim，改用 per-story 情报报告(运行时实际喂的源)逐个重判，
// 短路 supported/contradicted(复现 runtime runFaithfulnessCheck)。看是否从误拦恢复。
// per-story 源 = 各 intelligence_analysis 调用的 OUTPUT(情报报告)。
import { authHeaders } from '../_shared/backend.js';
import { judgeFactual } from './judge.js';
import type { Claim } from './types.js';

const B = process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';
const MODEL = process.env.JUDGE_MODEL || 'qwen-max';

async function j(url: string) { const r = await fetch(url, { headers: authHeaders() }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json() as any; }

// 取某 brief 的所有 per-story 情报报告(intelligence_analysis 输出)
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

// claim 对一组 per-story 源逐个判，短路：任一 supported→supported；任一 contradicted→contradicted；否则 unsupported
async function judgePerStory(claim: Claim, sources: string[]) {
  let sawContra = false;
  for (const src of sources) {
    const r = await judgeFactual(claim, src, MODEL);
    if (r.verdict === 'supported') return { verdict: 'supported', via: src.slice(0, 60) };
    if (r.verdict === 'contradicted') sawContra = true;
  }
  return { verdict: sawContra ? 'contradicted' : 'unsupported', via: '' };
}

// 5 个②误拦 claim(claimify-b2 gold=supported)，整源下 judge 误判为 unsupported/contradicted
const CLAIMS: Array<{ id: string; wf: string; text: string }> = [
  { id: '#5', wf: 'admin-brief-1780554095183', text: 'The toll across the three incidents stands at 9 killed and 150+ wounded, with 130 medical workers killed and 162 ambulances or facilities struck' },
  { id: '#22', wf: 'admin-brief-1780554095183', text: 'The incident follows a deadly March 2026 government hospital fire.' },
  { id: '#3', wf: 'admin-brief-1780662961660', text: 'KCNA claims production capacity has more than doubled compared with five years ago' },
  { id: '#12', wf: 'admin-brief-1780554095183', text: 'China rejects the premise outright.' },
  { id: '#2', wf: 'admin-brief-1780554095183', text: "US Central Command responded with 'self-defense' strikes on Qeshm Island, hitting ground control infrastructure and a telecommunications tower" },
];

async function main() {
  const cache: Record<string, string[]> = {};
  for (const c of CLAIMS) {
    if (!cache[c.wf]) { cache[c.wf] = await perStorySources(c.wf); console.log(`[${c.wf}] ${cache[c.wf].length} per-story sources`); }
    const claim: Claim = { id: 0, text: c.text, type: 'factual' };
    const res = await judgePerStory(claim, cache[c.wf]);
    const flip = res.verdict === 'supported' ? '✅ 恢复 supported' : `仍 ${res.verdict}`;
    console.log(`  ${c.id}: per-story → ${res.verdict}  [${flip}]`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
