/**
 * 一期 LLM 调用记录的列表路由（/observability/runs/:workflowId/llm-calls）。replay 的录像拉取
 * （test/replay/fetch-recording.mjs）靠它拿全一期的 key。R2 list 一次最多回 1000 个，
 * 写作–核查循环（ADR 0010）一期的调用记录会超过这个数，不翻页就拉不全。
 */
import { env, exports } from 'cloudflare:workers';
import { llmCallKey } from '@meridian/contracts';
import { describe, expect, it } from 'vitest';

describe('LLM 调用列表', () => {
  it('超过 1000 条也全部列出', async () => {
    const wf = 'wf-listing-1005';
    const n = 1005;
    for (let i = 0; i < n; i += 100) {
      await Promise.all(
        Array.from({ length: Math.min(100, n - i) }, (_, k) =>
          env.ARTICLES_BUCKET.put(
            llmCallKey(wf, 'brief_block_v6_check', i + k),
            JSON.stringify({ phase: 'brief_block_v6_check', call_index: i + k, request: { model: 'm' } })
          )
        )
      );
    }

    const res = await exports.default.fetch(`http://backend/observability/runs/${wf}/llm-calls`, {
      headers: { Authorization: `Bearer ${env.API_TOKEN}` },
    });
    const body = (await res.json()) as { success: boolean; total: number; calls: Array<{ key: string; call_index: number }> };

    expect(res.status).toBe(200);
    expect(body.total).toBe(n);
    expect(new Set(body.calls.map((c) => c.key)).size).toBe(n);
    expect(body.calls.map((c) => c.call_index).sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
  });
});
