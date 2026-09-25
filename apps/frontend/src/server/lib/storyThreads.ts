import type { StoryThreadDetail, StoryThreadListResponse, StoryThreadSummary } from '~/shared/types';
import {
  readFromBackend,
  type BackendStoryThreadDetail,
  type BackendStoryThreadList,
  type BackendStoryThreadSummary,
} from './backend';
import { ensureDate, formatReportDateCN, formatReportDateShortCN } from './utils';

/**
 * 事件追踪（跨期线索）的读者视图。线索的查询、阈值（STORY_THREAD_CONFIG）、进行中 / 暂无更新与升级中的判定
 * 都在 backend 的 lib/reader/story-threads.ts；这里只拼展示文案与中文日期。
 */

function updateLabel(daysSinceUpdate: number): string {
  const days = Number(daysSinceUpdate);
  if (days <= 0) return '今日更新';
  if (days === 1) return '昨日更新';
  return `${days} 天前更新`;
}

function toSummary(thread: BackendStoryThreadSummary): StoryThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    escalating: thread.escalating,
    summary: thread.summary,
    durationDays: thread.durationDays,
    briefCount: thread.briefCount,
    entryCount: thread.entryCount,
    updateLabel: updateLabel(thread.daysSinceUpdate),
  };
}

export async function listStoryThreads(): Promise<StoryThreadListResponse> {
  const list = await readFromBackend<BackendStoryThreadList>('/reader/stories');
  return {
    threads: list.threads.map(toSummary),
    counts: list.counts,
    activeWindowDays: list.activeWindowDays,
    minBriefs: list.minBriefs,
  };
}

export async function getStoryThread(id: number): Promise<StoryThreadDetail> {
  const thread = await readFromBackend<BackendStoryThreadDetail>(`/reader/stories/${id}`, 'Story thread not found');
  return {
    ...toSummary(thread),
    firstSeenCN: formatReportDateCN(ensureDate(thread.firstSeenAt)),
    lastSeenCN: formatReportDateCN(ensureDate(thread.lastSeenAt)),
    entries: thread.entries.map(entry => ({
      id: entry.id,
      dateShortCN: formatReportDateShortCN(ensureDate(entry.createdAt)),
      title: entry.title,
      description: entry.description,
      briefSlug: String(entry.reportId),
      briefNumber: entry.reportId,
      disputed: entry.disputed,
    })),
  };
}
