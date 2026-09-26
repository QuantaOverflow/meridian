/**
 * 按域名限流的分批处理（DomainRateLimiter）。它跑在 Workflow 的 run() 里，所以必须守 Workflow 的规则：
 * step 名是缓存键，要**确定**（不能拼实时算出的等待秒数）且**不重复**（同名 step 第二次直接返回缓存）；
 * 调度不能依赖 step 之外的内存状态（休眠醒来会清空）。
 *
 * WorkflowStep 是平台对象，这里用一个只记录 sleep 调用的替身；被测的是限流器自己的调度。
 */
import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from 'cloudflare:workers';
import { DomainRateLimiter } from '../../src/lib/api/rate-limiter';

type Item = { id: number; url: string };

function recordingStep() {
  const sleeps: Array<{ name: string; ms: number }> = [];
  const step = {
    sleep: async (name: string, duration: number) => {
      sleeps.push({ name, ms: Number(duration) });
    },
  } as unknown as WorkflowStep;
  return { step, sleeps };
}

async function run(items: Item[]) {
  const { step, sleeps } = recordingStep();
  const limiter = new DomainRateLimiter<Item>({ maxConcurrent: 3, globalCooldownMs: 1000, domainCooldownMs: 5000 });
  // 用「已经 sleep 的总时长」当模拟时钟，记下每个 item 在第几轮、第几毫秒被处理
  const processed: Array<{ id: number; domain: string; at: number }> = [];
  const results = await limiter.processBatch(items, step, async (item, domain) => {
    processed.push({ id: item.id, domain, at: sleeps.reduce((t, s) => t + s.ms, 0) });
    return item.id;
  });
  return { sleeps, processed, results };
}

const items: Item[] = [
  { id: 1, url: 'https://a.example/1' },
  { id: 2, url: 'https://a.example/2' },
  { id: 3, url: 'https://a.example/3' },
  { id: 4, url: 'https://b.example/1' },
  { id: 5, url: 'https://c.example/1' },
  { id: 6, url: 'https://d.example/1' },
  { id: 7, url: 'https://b.example/2' },
];

describe('DomainRateLimiter', () => {
  it('每个 item 恰好处理一次，非法 URL 跳过', async () => {
    const { results } = await run([...items, { id: 99, url: 'not a url' }]);
    expect([...results].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('step 名不重复，且同样的输入两次运行得到完全相同的 sleep 序列', async () => {
    const first = await run(items);
    const second = await run(items);
    const names = first.sleeps.map(s => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(second.sleeps).toEqual(first.sleeps);
    // 名字里不带实时算出的等待时长
    for (const n of names) expect(n).not.toMatch(/\d+s\)/);
  });

  it('同一域名两次处理间隔不少于 domainCooldownMs，每轮不超过 maxConcurrent', async () => {
    const { processed } = await run(items);
    const byDomain = new Map<string, number[]>();
    for (const p of processed) byDomain.set(p.domain, [...(byDomain.get(p.domain) ?? []), p.at]);
    for (const times of byDomain.values()) {
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(5000);
    }
    const perRound = new Map<number, number>();
    for (const p of processed) perRound.set(p.at, (perRound.get(p.at) ?? 0) + 1);
    for (const n of perRound.values()) expect(n).toBeLessThanOrEqual(3);
  });
});
