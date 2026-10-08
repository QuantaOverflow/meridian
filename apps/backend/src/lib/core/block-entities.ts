import type { BlockEntity } from '@meridian/contracts';
import { countryOfEntity } from './places';

/**
 * 一个故事的成员文章 → 这一块的实体（见 GLOSSARY.md「实体」）。只有这一份：写简报块时存在块上
 * （brief-blocks.ts），实体页与块下的实体链接都按存下的查。
 * 写法只归一大小写与首尾空白，不合并别名（`Volodymyr Zelenskyy` 与 `Volodymyr Zelensky` 是两个实体，用户 2026-10-08 定）。
 */

/**
 * 至少这个比例的成员文章提到，才算这一块的实体。只被一两篇顺带提到的名字不算：
 * 2026-10-08 在 staging 的 457 块上量，「任一成员提到」时过门槛的写法有 740 种，按一半算剩 153 种（含国家）。
 */
const ENTITY_MIN_SHARE = 0.5;

/**
 * 媒体名（归一后的写法）：关键实体里混着报道方自己的名字（近 30 天 `CNN` 189 篇、`Al Jazeera` 159 篇），不当实体。
 * 表取自 2026-10-08 生产近 30 天出现 6 篇以上的媒体写法，加源池里的名字；看到新的再补。
 * 代价：媒体自己是新闻主角的块（如 CNN 被拒绝随行采访）也不挂这个实体。
 */
const MEDIA_NAMES = new Set([
  'cnn', 'al jazeera', 'politico', 'ms now', 'msnbc', 'euronews', 'bbc', 'bbc news', 'france 24', 'france24',
  'south china morning post', 'scmp', 'reuters', 'reuters/ipsos', 'fox news', 'cbs', 'cbs news', 'npr',
  'new york times', 'the new york times', 'afp', 'agence france-presse', 'wall street journal', 'the wall street journal',
  'indian express', 'the indian express', 'haaretz', 'guardian', 'the guardian', 'guardian australia', '端傳媒',
  'washington post', 'the washington post', 'bloomberg', 'bloomberg news', 'abc', 'abc news', 'cctv', 'xinhua',
  'associated press', 'the associated press', 'ap', 'new york post', 'global times', 'independent', 'the independent',
  'nbc', 'nbc news', 'financial times', 'the atlantic', 'daily mail', 'the diplomat', 'axios', 'los angeles times',
  'the telegraph', 'times of india', 'the times of india', 'hacker news', 'sky news', 'the hill', 'the times',
  'usa today', 'the economist', 'tass', 'interfax', 'yonhap', 'kyodo', 'kyodo news', 'pbs', 'cnbc', 'newsweek',
  'korean central news agency', 'kcna', 'al arabiya', 'times of israel', 'the times of israel', 'jerusalem post',
  'the jerusalem post', 'deutsche welle', 'dw', 'nhk', 'the verge', 'techcrunch', 'wired',
]);

/** 归一后的写法：小写、去首尾空白 */
export const entityKey = (raw: string) => raw.trim().toLowerCase();

/** 这个写法算不算实体：空的、能归成国家的（走国家页）、媒体名都不算 */
const isEntity = (key: string) => key !== '' && !MEDIA_NAMES.has(key) && countryOfEntity(key) === null;

/**
 * 这一块的实体：被至少一半成员文章提到的写法，提到的篇数多的在前（相同按写法）。
 * 一篇里重复写只算一次。显示写法取各篇里最常见的原文（去首尾空白；一样多取字典序小的）。没有成员时为 []。
 */
export function blockEntities(members: number[], entitiesOf: Map<number, string[]>): BlockEntity[] {
  const articles = new Map<string, number>();
  const writings = new Map<string, Map<string, number>>();
  for (const id of members) {
    const seen = new Set<string>();
    for (const raw of entitiesOf.get(id) ?? []) {
      const key = entityKey(raw);
      if (!isEntity(key)) continue;
      const names = writings.get(key) ?? new Map<string, number>();
      names.set(raw.trim(), (names.get(raw.trim()) ?? 0) + 1);
      writings.set(key, names);
      if (seen.has(key)) continue;
      seen.add(key);
      articles.set(key, (articles.get(key) ?? 0) + 1);
    }
  }
  return [...articles]
    .filter(([, n]) => n >= members.length * ENTITY_MIN_SHARE)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => ({
      key,
      name: [...writings.get(key)!].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    }));
}
