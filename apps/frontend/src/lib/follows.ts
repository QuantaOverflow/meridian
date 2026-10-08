/**
 * 关注项（见 GLOSSARY.md「关注项」）：读者标记要持续看的国家与线索。没有账号，只记在这台设备的浏览器里（localStorage）。
 * 这里是读写与判定的纯函数，存储由调用方传进来；页面状态在 composables/useFollows.ts。
 * localStorage 可能不存在或一碰就抛（隐私模式、被禁用）：读不到按「没有关注项」算，写不进去只是不持久，都不报错。
 */

/** 线索的标题在关注时记一份，Following 页列关注项时不用再去取；实际显示以后端带回的最新标题为准 */
export type Follow = { kind: 'country'; code: string } | { kind: 'thread'; id: number; title: string };

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const FOLLOWS_KEY = 'meridian-follows';
const LAST_VISIT_KEY = 'meridian-following-last-visit';

/** 浏览器的 localStorage；没有、或访问它就抛时为 null */
export function browserStorage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const followKey = (follow: Follow) => (follow.kind === 'country' ? `country:${follow.code}` : `thread:${follow.id}`);

function parseFollow(raw: unknown): Follow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  if (item.kind === 'country' && typeof item.code === 'string' && /^[A-Z]{2}$/.test(item.code)) {
    return { kind: 'country', code: item.code };
  }
  if (item.kind === 'thread' && Number.isInteger(item.id) && (item.id as number) > 0) {
    return { kind: 'thread', id: item.id as number, title: typeof item.title === 'string' ? item.title : '' };
  }
  return null;
}

/** 存着的关注项；读不到、不是合法 JSON、形状不对的条目一律略过 */
export function readFollows(storage: KeyValueStore | null): Follow[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(FOLLOWS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.flatMap(raw => {
      const follow = parseFollow(raw);
      if (follow === null || seen.has(followKey(follow))) return [];
      seen.add(followKey(follow));
      return [follow];
    });
  } catch {
    return [];
  }
}

export function writeFollows(storage: KeyValueStore | null, follows: Follow[]): void {
  try {
    storage?.setItem(FOLLOWS_KEY, JSON.stringify(follows));
  } catch {
    // 写不进去（隐私模式、配额满）：这次会话里关注照常生效，只是不持久
  }
}

/** 已关注就取消，没关注就加在最后 */
export function toggleFollow(follows: Follow[], follow: Follow): Follow[] {
  const key = followKey(follow);
  return follows.some(f => followKey(f) === key) ? follows.filter(f => followKey(f) !== key) : [...follows, follow];
}

/** 上次打开 Following 页的时刻（ISO）；没来过、读不到或存的不是时间为 null */
export function readLastVisit(storage: KeyValueStore | null): string | null {
  try {
    const raw = storage?.getItem(LAST_VISIT_KEY) ?? null;
    return raw !== null && !Number.isNaN(Date.parse(raw)) ? raw : null;
  } catch {
    return null;
  }
}

export function writeLastVisit(storage: KeyValueStore | null, iso: string): void {
  try {
    storage?.setItem(LAST_VISIT_KEY, iso);
  } catch {
    // 同 writeFollows：不持久，下次来没有 new 标记
  }
}

/**
 * 一块算不算「上次访问之后新出的」：它所属那一期的生成时刻严格晚于上次访问。
 * 第一次来（没有上次访问）一律不算——否则整页都是 new，标记不带信息。
 */
export function isNewSince(briefCreatedAt: string, lastVisit: string | null): boolean {
  return lastVisit !== null && Date.parse(briefCreatedAt) > Date.parse(lastVisit);
}
