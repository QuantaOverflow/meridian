/**
 * R2 key 构造函数的 characterization test：期望值是改用 @meridian/contracts 之前各写入/读取处
 * 手拼出来的字面量。生产桶里已有的对象全按这些格式落的，差一个字节就读不到历史数据。
 */
import { describe, expect, it } from 'vitest';
import {
  articleContentKey,
  articleJourneyKey,
  briefV3RecordKey,
  clusteringSnapshotKey,
  datasetEmbeddingsKey,
  LLM_CALLS_ROOT,
  llmCallKey,
  llmCallsPrefix,
  sensorKey,
  workflowObservabilityKey,
} from '@meridian/contracts';

describe('R2 key 与改造前手拼的字面量逐字节一致', () => {
  it('文章正文：UTC 日期、月日不补零', () => {
    expect(articleContentKey(new Date('2026-09-05T23:30:00Z'), 1102027)).toBe('2026/9/5/1102027.txt');
    // 东八区的 1 月 1 日凌晨在 UTC 仍是前一年最后一天
    expect(articleContentKey(new Date('2026-01-01T00:30:00+08:00'), 7)).toBe('2025/12/31/7.txt');
    expect(articleContentKey(new Date('2026-11-23T12:00:00Z'), 42)).toBe('2026/11/23/42.txt');
  });

  it('workflow 级对象', () => {
    const wf = 'cron-brief-1790168539876';
    expect(datasetEmbeddingsKey(wf)).toBe('datasets/cron-brief-1790168539876/embeddings.json');
    expect(workflowObservabilityKey(wf)).toBe('observability/cron-brief-1790168539876.json');
    expect(clusteringSnapshotKey(wf)).toBe('observability/clustering/cron-brief-1790168539876.json');
    expect(articleJourneyKey(wf)).toBe('observability/article-journey/cron-brief-1790168539876.json');
    expect(briefV3RecordKey(wf)).toBe('observability/brief-v3/cron-brief-1790168539876.json');
  });

  it('LLM 调用日志：序号补到 3 位、超过 3 位不截断；列举前缀带尾斜杠', () => {
    expect(llmCallKey('wf-1', 'brief_block_v6', 7)).toBe('llm-calls/wf-1/brief_block_v6-007.json');
    expect(llmCallKey('wf-1', 'brief_generation', 690)).toBe('llm-calls/wf-1/brief_generation-690.json');
    expect(llmCallKey('wf-1', 'brief_block_v6', 1703)).toBe('llm-calls/wf-1/brief_block_v6-1703.json');
    expect(llmCallsPrefix('wf-1')).toBe('llm-calls/wf-1/');
    expect(LLM_CALLS_ROOT).toBe('llm-calls/');
  });

  it('传感器读数', () => {
    expect(sensorKey('wf-1', 'output_language', 3)).toBe('observability/sensors/wf-1/output_language-003.json');
  });
});
