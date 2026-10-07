/**
 * 落点规则（ADR 0009 决定 4）：一个故事标在哪个国家、与哪国连线。两侧共用这一份——
 * 前端地图首页按它画点与连线；backend 写简报块时按它算块的落点国家与涉及国家（`blockCountries`），国家页按那两列查。
 * 输入是 backend 给的占比（BriefMapEvent 的 places / mentions，算法在 backend lib/reader/story-countries.ts）。
 */
import type { BriefMapEvent } from './reader-map';

// 落点与原型 places.py 的 place() 同口径；连线的第二个国家改看 mentions（ADR 0009 决定 4）
const PLACE_MIN = 0.3; // 头号国家占比达到它 → 标在这个国家
// 标在一国时，另一国被至少 2/3 的成员提到、且不与下一名并列 → 画关联线。原型按地点占比 ≥15% 连，
// 但一事的报道几乎都填同一个地点，几乎连不出线；111–115 期量过这条规则：连出 30 条，无强行关联
const MENTION_LINK_MIN = 2 / 3;
const SPREAD_MIN = 0.1; // 没有国家达到 PLACE_MIN 时，占比达到它的国家两两连线

/** mentions 的占比是三位小数，2/3 给的是 0.667 */
const mentionedEnough = (share: number) => share >= MENTION_LINK_MIN - 0.001;

export interface Placement {
  primary: string | null;
  secondary: string | null;
  /** 跨地区：至少两国才算，否则为空 */
  spread: string[];
}

/** places、mentions 都已按占比降序（契约保证） */
export function place(places: BriefMapEvent['places'], mentions: BriefMapEvent['mentions']): Placement {
  const [first] = places;
  const primary = first && first.share >= PLACE_MIN ? first.country : null;
  const [top, next] = primary ? mentions.filter(m => m.country !== primary) : [];
  const secondary = top && mentionedEnough(top.share) && next?.share !== top.share ? top.country : null;
  const spread = primary ? [] : places.filter(p => p.share >= SPREAD_MIN).slice(0, 4).map(p => p.country);
  return { primary, secondary, spread: spread.length >= 2 ? spread : [] };
}

/** 一个简报块对国家的归属，写块时算好存在块上 */
export interface BlockCountries {
  /** 落点国家（= place 的 primary）；跨地区或没有国家的故事为 null */
  placement: string | null;
  /** 涉及的国家：不含落点国家，按代码升序 */
  mentions: string[];
}

/**
 * 涉及 = 落点之外，被至少 2/3 的成员文章提到的国家，加上跨地区故事铺开的那几国。
 * 与连线同一个门槛，但连线只挑一个、并列时不连；这里是列表，并列的都算。
 */
export function blockCountries(places: BriefMapEvent['places'], mentions: BriefMapEvent['mentions']): BlockCountries {
  const { primary, spread } = place(places, mentions);
  const mentioned = mentions.filter(m => mentionedEnough(m.share)).map(m => m.country);
  return { placement: primary, mentions: [...new Set([...mentioned, ...spread])].filter(c => c !== primary).sort() };
}
