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
/** 至少三分之二的成员带这个主题的某个标签 */
const TOPIC_MIN = 0.67;
const TOPIC_MAX = 2;

/** topic_tags 是 jsonb：只取字符串，去空白转小写、去重 */
export function normalizeTags(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((t): t is string => typeof t === 'string').map(t => t.trim().toLowerCase()));
}

/**
 * 一条故事的主题：tagCounts 是「带这个标签的成员数」，members 是成员数。
 * 主题的得分取它名下标签里命中最多的那个（不是并集），≥ TOPIC_MIN 才算；按得分降序取前两个，同分按上表顺序。
 */
export function assignTopics(tagCounts: Map<string, number>, members: number): MapTopic[] {
  const scored: { share: number; topic: MapTopic }[] = [];
  for (const [topic, tags] of TOPIC_TAGS) {
    const share = Math.max(0, ...tags.map(t => tagCounts.get(t) ?? 0)) / members;
    if (share >= TOPIC_MIN) scored.push({ share, topic });
  }
  // Array.prototype.sort 是稳定排序，同分保持上表顺序（与原型 Python 的 sort 一致）
  scored.sort((a, b) => b.share - a.share);
  const topics = scored.slice(0, TOPIC_MAX).map(s => s.topic);
  return topics.length > 0 ? topics : ['politics'];
}

/** 一篇文章命中的全部主题；一个都没命中而带 politics 标签时归 politics，否则不计 */
export function articleTopics(tags: Set<string>): MapTopic[] {
  const topics: MapTopic[] = TOPIC_TAGS.filter(([, ts]) => ts.some(t => tags.has(t))).map(([topic]) => topic);
  if (topics.length > 0) return topics;
  return tags.has('politics') ? ['politics'] : [];
}
