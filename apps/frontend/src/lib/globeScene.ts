/**
 * 页面与地球渲染器之间的全部约定：页面给场景（点、连线、国家底色）和悬停提示的内容，
 * 渲染器（components/HoloGlobe.client.vue + lib/holoGlobe.ts）负责画、拾取、旋转、缩放与皮肤。
 * 换 three.js 渲染器时这个文件不动，只换那两个文件。
 */

export interface GlobeDot {
  /** 国家代码，坐标查 lib/briefMap.ts 的 COUNTRIES */
  key: string;
  /** 缩放为 1 时的半径 */
  r: number;
  /** 头条所在国：外圈脉动 */
  pulse: boolean;
  label: string;
  /** 不在当前主题筛选里：淡出 */
  fade: boolean;
  /** 只是连线的终点、当天没有故事落在这里：小空心圈，标签只写国名 */
  hollow: boolean;
}

export interface GlobeLink {
  a: string;
  b: string;
  /** second = 主国家到第二国家；spread = 没有主国家时占比 ≥10% 的国家两两相连 */
  kind: 'second' | 'spread';
  /** 牵涉锁定国家的连线：实线高亮 */
  focus: boolean;
}

export interface GlobeScene {
  dots: GlobeDot[];
  links: GlobeLink[];
  /** 国家 → 0..1 的底色深浅；null = 关掉底色。有点或有底色的国家才能点选 */
  shaded: Map<string, number> | null;
}

/** 悬停提示的内容（纯数据，由渲染器排版） */
export interface GlobeTip {
  title: string;
  topics: { name: string; on: boolean }[];
  /** 至多 3 条故事标题 */
  titles: string[];
  /** 「N more」，没有更多时为 null */
  more: string | null;
  /** 没有故事的国家：当天报道在谈什么 */
  loose: string | null;
  footer: string;
}
