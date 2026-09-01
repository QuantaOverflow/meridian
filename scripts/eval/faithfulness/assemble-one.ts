// 给单个 workflowId 组装 run-level-eval 输入行：拉 brief 全文 + 15 个 per-story 情报源。
// 用法：tsx assemble-one.ts <workflowId> [should_block] > out.jsonl
import { authHeaders } from '../_shared/backend.js';
import process from 'node:process';

const B = process.env.BACKEND_URL || 'https://meridian-backend.swj299792458.workers.dev';

async function j(url: string): Promise<any> {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function main() {
  const wf = process.argv[2];
  if (!wf) throw new Error('用法: tsx assemble-one.ts <workflowId> [should_block]');
  const shouldBlock = process.argv[3]; // 可选 'true'/'false'

  const list = await j(`${B}/observability/runs/${wf}/llm-calls`);
  const calls = list.calls || [];

  // 情报源：phase=intelligence_analysis 的 response.content（= 门逐源判的 per-story 报告）
  const ia = calls.filter((c: any) => c.phase === 'intelligence_analysis');
  const sources: { storyId: string; content: string }[] = [];
  for (let i = 0; i < ia.length; i++) {
    const raw = await j(`${B}/observability/llm-calls/${ia[i].key}`);
    const content = raw.response?.content || '';
    if (content) sources.push({ storyId: `s${i + 1}`, content });
  }

  // 简报全文：phase=brief_generation 取 response.content 最长的那次
  const bg = calls.filter((c: any) => c.phase === 'brief_generation');
  let brief = '';
  for (const c of bg) {
    const raw = await j(`${B}/observability/llm-calls/${c.key}`);
    const content = raw.response?.content || '';
    if (content.length > brief.length) brief = content;
  }

  const rec: any = { brief_id: wf, brief, sources };
  if (shouldBlock === 'true' || shouldBlock === 'false') rec.should_block = shouldBlock === 'true';
  process.stderr.write(`[assemble] ${wf}: brief ${brief.length} chars, ${sources.length} sources\n`);
  process.stdout.write(JSON.stringify(rec) + '\n');
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
