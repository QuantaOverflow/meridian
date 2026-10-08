import { describe, expect, it } from 'vitest';
import { blockCountries, place } from '@meridian/contracts';
import { linkEnds } from '../src/lib/briefMap';

// 落点与连线（ADR 0009 决定 4）。连线的第二个国家看 mentions：2026-10 在 111–115 期 121 个故事上量过，
// 至少 2/3 成员提到、且不与下一名并列时，连出的 30 条里没有强行关联（并列和 Georgia 是两类强行关联的来源）。
describe('place：第二个国家（连线）', () => {
  it('另一国被至少 2/3 的成员提到 → 连线', () => {
    const p = place([{ country: 'KR', share: 1 }], [{ country: 'KR', share: 1 }, { country: 'KP', share: 0.75 }]);
    expect(p).toEqual({ primary: 'KR', secondary: 'KP', spread: [] });
  });

  it('正好 2/3（接口给的是三位小数 0.667）也连', () => {
    expect(place([{ country: 'GB', share: 1 }], [{ country: 'IR', share: 0.667 }]).secondary).toBe('IR');
  });

  it('不到 2/3 不连', () => {
    expect(place([{ country: 'US', share: 1 }], [{ country: 'FR', share: 0.6 }]).secondary).toBeNull();
  });

  it('前两名并列不连（取哪个都可能是错的）', () => {
    const mentions = [{ country: 'AT', share: 0.667 }, { country: 'PS', share: 0.667 }];
    expect(place([{ country: 'IE', share: 1 }], mentions).secondary).toBeNull();
  });

  it('主国家自己不算第二个国家；只看 mentions，地点占比里的第二名不再连线', () => {
    const p = place(
      [{ country: 'AE', share: 0.64 }, { country: 'OM', share: 0.23 }],
      [{ country: 'AE', share: 0.9 }, { country: 'SA', share: 0.59 }, { country: 'OM', share: 0.3 }]
    );
    expect(p.secondary).toBeNull();
  });

  it('没有主国家时照旧按地点占比两两连线，不看 mentions', () => {
    const p = place(
      [{ country: 'US', share: 0.25 }, { country: 'CN', share: 0.2 }, { country: 'FR', share: 0.05 }],
      [{ country: 'RU', share: 1 }]
    );
    expect(p).toEqual({ primary: null, secondary: null, spread: ['US', 'CN'] });
  });
});

describe('linkEnds：连线终点标记', () => {
  it('只挑没有故事落点的端点，去重', () => {
    const links = [{ a: 'UA', b: 'RU' }, { a: 'LV', b: 'RU' }, { a: 'SA', b: 'YE' }];
    expect(linkEnds(links, new Set(['UA', 'LV', 'SA']))).toEqual(['RU', 'YE']);
  });

  it('两端都有落点时不加标记', () => {
    expect(linkEnds([{ a: 'KR', b: 'KP' }], new Set(['KR', 'KP']))).toEqual([]);
  });
});

// 简报块对国家的归属（国家页按它分两节）：落点 = place 的主国家；涉及 = 落点之外被至少 2/3 成员提到的国家，加上跨地区铺开的几国
describe('blockCountries：块的落点国家与涉及国家', () => {
  it('落点在一国，另一国被至少 2/3 的成员提到 → 涉及', () => {
    const c = blockCountries([{ country: 'KR', share: 1 }], [{ country: 'KR', share: 1 }, { country: 'KP', share: 0.75 }, { country: 'US', share: 0.5 }]);
    expect(c).toEqual({ placement: 'KR', mentions: ['KP'] });
  });

  it('并列的都算涉及（连线只挑一个所以并列不连，列表没有这个问题），按代码升序', () => {
    const c = blockCountries([{ country: 'IE', share: 1 }], [{ country: 'PS', share: 0.667 }, { country: 'AT', share: 0.667 }]);
    expect(c).toEqual({ placement: 'IE', mentions: ['AT', 'PS'] });
  });

  it('跨地区的故事没有落点，铺开的几国都算涉及', () => {
    const c = blockCountries(
      [{ country: 'US', share: 0.25 }, { country: 'CN', share: 0.2 }, { country: 'FR', share: 0.05 }],
      [{ country: 'RU', share: 1 }, { country: 'US', share: 0.25 }]
    );
    expect(c).toEqual({ placement: null, mentions: ['CN', 'RU', 'US'] });
  });

  it('没有任何国家', () => {
    expect(blockCountries([], [])).toEqual({ placement: null, mentions: [] });
  });
});
