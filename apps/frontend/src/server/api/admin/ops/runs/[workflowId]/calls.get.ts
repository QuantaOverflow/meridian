import { readFromBackend } from '~/server/lib/backend';

/** 一次运行里一条模型调用的简要信息（backend 的 /observability/runs/:wf/llm-calls 原样返回） */
export interface OpsRunCall {
  key: string;
  uploaded: string;
  size: number;
  phase?: string;
  call_index?: number;
  provider?: string;
  model?: string;
  tokens?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; neurons?: number };
  latency_ms?: number;
  error?: string | null;
}

// 一次运行的全部模型调用列表（不含正文；单条全文走 ../../calls/[...key]）
export default defineEventHandler(async (event): Promise<{ success: boolean; total: number; calls: OpsRunCall[] }> => {
  const workflowId = encodeURIComponent(getRouterParam(event, 'workflowId') ?? '');
  return await readFromBackend(`/observability/runs/${workflowId}/llm-calls`, 'Run not found');
});
