/**
 * 前端不连数据库：读者页与后台的读数都从 backend 取（`/reader/*`、`GET /admin/sources*`，查询在 backend 的
 * `src/lib/reader/`），带 `NUXT_WORKER_API_TOKEN`。写操作的转发见 sourceActions.ts。
 *
 * 这里的类型是 backend 响应的 JSON 形状（日期是 ISO 字符串），以 backend 的 lib/reader 为准。
 * backend 回 404 → 抛调用方给的 404 文案（与原先直连库时的错误响应一致）；其余非 2xx 与连不上 → 502。
 */
export async function readFromBackend<T>(path: string, notFoundMessage = 'Not found'): Promise<T> {
  const config = useRuntimeConfig();

  let response: Response;
  try {
    response = await fetch(`${config.public.WORKER_API}${path}`, {
      headers: { Authorization: `Bearer ${config.worker.api_token}` },
    });
  } catch (error) {
    console.error(`Failed to read ${path}`, error);
    throw createError({ statusCode: 502, statusMessage: 'Backend unreachable' });
  }
  if (response.status === 404) {
    throw createError({ statusCode: 404, statusMessage: notFoundMessage });
  }
  if (!response.ok) {
    console.error(`Backend failed to serve ${path}`, { status: response.status, body: await response.text().catch(() => '') });
    throw createError({ statusCode: 502, statusMessage: `Backend returned ${response.status}` });
  }
  return (await response.json()) as T;
}

// ── /reader/briefs* ─────────────────────────────────────────────

export interface BackendBriefListItem {
  id: number;
  createdAt: string;
  title: string;
  tldrProse: string | null;
  /** 正文里 <u> 事件条目的个数 */
  storyCount: number;
  wordCount: number;
}

export interface BackendBriefList {
  items: BackendBriefListItem[];
  matched: number;
  total: number;
  earliest: string | null;
}

export interface BriefSourceArticle {
  title: string;
  url: string;
}

/** 简报级来源清单的一个信源（口径与为什么是简报级，见 backend lib/reader/briefs.ts） */
export interface BriefSource {
  name: string;
  articles: BriefSourceArticle[];
}

export interface BackendBriefDetail {
  id: number;
  createdAt: string;
  title: string;
  /** 正文 markdown 原文 */
  content: string;
  tldrProse: string | null;
  usedArticles: number;
  usedSources: number;
  sources: BriefSource[];
  sourceArticleCount: number;
}

// ── /reader/stories* ────────────────────────────────────────────

export interface BackendStoryThreadSummary {
  id: number;
  title: string;
  status: 'active' | 'dormant';
  escalating: boolean;
  summary: string;
  durationDays: number;
  briefCount: number;
  entryCount: number;
  daysSinceUpdate: number;
}

export interface BackendStoryThreadList {
  threads: BackendStoryThreadSummary[];
  counts: { active: number; dormant: number; all: number };
  activeWindowDays: number;
  minBriefs: number;
}

export interface BackendStoryThreadDetail extends BackendStoryThreadSummary {
  firstSeenAt: string;
  lastSeenAt: string;
  entries: {
    id: number;
    createdAt: string;
    title: string;
    description: string;
    reportId: number;
    disputed: boolean;
  }[];
}

// ── /admin/sources* （前端原样返回，页面按这些类型推断）─────────

export interface AdminSourceStats {
  id: number;
  name: string;
  url: string;
  category: string;
  paywall: boolean;
  frequency: string;
  lastChecked?: string;
  totalArticles: number;
  avgPerDay: number;
  processSuccessRate: number | null;
  errorRate: number | null;
  lowQualityRate: number | null;
}

export interface AdminSourcesResponse {
  overview: {
    lastSourceCheck: string | null;
    lastArticleProcessed: string | null;
    lastArticleFetched: string | null;
    articlesProcessedToday: number;
    articlesFetchedToday: number;
    errorsToday: number;
    staleSourcesCount: number;
    totalSourcesCount: number;
  } | null;
  sources: AdminSourceStats[];
}

export interface AdminSourceDetails {
  name: string;
  url: string;
  initialized: boolean;
  pausedAt: string | null;
  frequency: string;
  lastFetched?: string;
  articles: {
    id: number;
    title: string;
    url: string;
    publishedAt?: string;
    status: string | null;
    completeness: string | null;
    content_quality: string | null;
    failReason: string | null;
    language: string | null;
    primary_location: string | null;
    processedAt?: string;
    hasEmbedding: boolean;
  }[];
  pagination: { totalPages: number; totalItems: number };
}
