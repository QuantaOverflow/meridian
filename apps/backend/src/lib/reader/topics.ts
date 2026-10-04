import type { MapTopic } from '@meridian/contracts';

/**
 * articles.topic_tags → 读者看的 9 个主题。地图（brief-map.ts）用，从地图原型的 topics.py 搬来。
 *
 * 原始标签太宽：Politics / World Affairs 几乎每篇都带，所以 politics 只在别的主题都不沾时兜底。
 * 标签比对前去首尾空白、转小写。主题的展示名在前端。
 */
const TOPIC_TAGS: [Exclude<MapTopic, 'politics'>, string[]][] = [
  ['security', ['security', 'conflict', 'war', 'military', 'counter-terrorism', 'election security']],
  ['tech', ['technology', 'artificial intelligence', 'space exploration', 'space', 'science', 'innovation', 'engineering', 'technology industry', 'gaming']],
  ['economy', ['economy', 'business', 'real estate', 'finance', 'energy', 'agriculture', 'labor rights', 'labour markets', 'labor issues', 'retail', 'entrepreneurship', 'investment strategy']],
  ['justice', ['crime', 'justice', 'legal system', 'justice system', 'legal issues', 'legal affairs', 'law', 'law enforcement', 'violence', 'international law', 'family law', 'legal', 'criminal justice', 'criminal law', 'corruption', 'true crime', 'prisons']],
  ['society', ['human rights', 'refugee crisis', 'migration', 'social issues', 'social policy', 'education', 'social movements', 'health', 'mental health', "women's issues", 'campus life', 'public health', 'immigration', 'social justice', 'gender equality', 'housing']],
  ['environment', ['environment', 'disaster response', 'weather', 'global climate', 'natural hazards', 'climate change', 'conservation', 'wildlife', 'disaster management']],
  ['culture', ['religion', 'culture', 'ethics', 'arts', 'art', 'music', 'entertainment', 'history', 'film']],
  ['sports', ['sports', 'sport', 'football', 'international competitions', 'athletics', 'tennis']],
];
const TOPIC_MAX = 2;

/** topic_tags 是 jsonb：只取字符串，去空白转小写、去重 */
export function normalizeTags(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((t): t is string => typeof t === 'string').map(t => t.trim().toLowerCase()));
}

/**
 * 一条故事的主题：tagCounts 是「带这个标签的成员数」，members 是成员数。
 * 主题的命中数取它名下标签里命中最多的那个（不是并集），至少三分之二的成员才算（整数比较，正好 2/3 也算；
 * 原型写的是 0.67，会把 2/3 挡在外面）；按命中数降序取前两个，同数按上表顺序。没有成员时为 []，不兜底。
 */
export function assignTopics(tagCounts: Map<string, number>, members: number): MapTopic[] {
  if (members === 0) return [];
  const scored: { hits: number; topic: MapTopic }[] = [];
  for (const [topic, tags] of TOPIC_TAGS) {
    const hits = Math.max(0, ...tags.map(t => tagCounts.get(t) ?? 0));
    if (hits * 3 >= members * 2) scored.push({ hits, topic });
  }
  // Array.prototype.sort 是稳定排序，同数保持上表顺序（与原型 Python 的 sort 一致）
  scored.sort((a, b) => b.hits - a.hits);
  const topics = scored.slice(0, TOPIC_MAX).map(s => s.topic);
  return topics.length > 0 ? topics : ['politics'];
}

/** 一篇文章命中的全部主题；一个都没命中而带 politics 标签时归 politics，否则不计 */
export function articleTopics(tags: Set<string>): MapTopic[] {
  const topics: MapTopic[] = TOPIC_TAGS.filter(([, ts]) => ts.some(t => tags.has(t))).map(([topic]) => topic);
  if (topics.length > 0) return topics;
  return tags.has('politics') ? ['politics'] : [];
}
