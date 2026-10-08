import { describe, expect, it } from 'vitest';
import { PLACE_CODES } from '../../backend/src/lib/core/places';
import { COUNTRIES } from '../src/lib/briefMap';

// backend 的地点归一化表与前端的国家展示表各维护一份（spec：展示表在前端）。backend 能产出、
// 前端却没有的代码，地球上画不出来、名字也只显示代码，所以两边必须同步补。
describe('地点表两边同步', () => {
  it('backend 归一可能产出的每个国家代码，前端展示表都有', () => {
    const missing = [...PLACE_CODES].filter(code => !(code in COUNTRIES));
    expect(missing).toEqual([]);
  });
});
