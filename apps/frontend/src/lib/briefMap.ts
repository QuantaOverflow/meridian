/**
 * 地图首页的展示规则与展示表（spec「Frontend: map homepage」）：落点阈值、国家代码 → 英文名 / 坐标 / 底图名、
 * 主题 → 英文名。backend 只给每个故事按国家的占比（BriefMap），怎么落点、怎么叫都在这里。
 * 表从原型 prototypes/globe 的 places.py（C + EN_NAME）与 topics.py（EN）搬来。
 */
import type { BriefMapEvent, MapTopic } from '@meridian/contracts';

export interface Country {
  name: string;
  /** world-atlas countries-110m 里的名字；null = 底图没有轮廓（小国、港澳、联合国），只画点 */
  atlas: string | null;
  lat: number;
  lon: number;
}

// [英文名, world-atlas 名, lat, lon]；英文名为 null 时用 world-atlas 名
const C: Record<string, [string | null, string | null, number, number]> = {
  US: ['United States', 'United States of America', 39, -98], IR: [null, 'Iran', 32.5, 54],
  UA: [null, 'Ukraine', 49, 31.5], RU: [null, 'Russia', 57, 45],
  PL: [null, 'Poland', 52, 19.5], CA: [null, 'Canada', 57, -100],
  NO: [null, 'Norway', 61, 9], FR: [null, 'France', 46.5, 2.5],
  MD: [null, 'Moldova', 47, 28.5], KR: [null, 'South Korea', 36.3, 127.8],
  BE: [null, 'Belgium', 50.6, 4.6], DE: [null, 'Germany', 51, 10.3],
  DK: [null, 'Denmark', 56, 9.5], GB: ['UK', 'United Kingdom', 53, -1.8],
  JP: [null, 'Japan', 36.5, 138.5], CO: [null, 'Colombia', 4, -73],
  VE: [null, 'Venezuela', 7, -66], AE: ['UAE', 'United Arab Emirates', 24, 54],
  QA: [null, 'Qatar', 25.3, 51.2], JO: [null, 'Jordan', 31, 36.5],
  SA: [null, 'Saudi Arabia', 24, 45], OM: [null, 'Oman', 21, 57],
  PK: [null, 'Pakistan', 30, 70], BH: ['Bahrain', null, 26, 50.5],
  YE: [null, 'Yemen', 15.5, 48], IN: [null, 'India', 22, 79],
  CN: [null, 'China', 35, 104], IQ: [null, 'Iraq', 33, 44],
  KW: [null, 'Kuwait', 29.3, 47.6], AF: [null, 'Afghanistan', 34, 66],
  PS: ['Palestine', 'Palestine', 31.9, 35.2], IL: [null, 'Israel', 31.4, 34.9],
  ID: [null, 'Indonesia', -2, 118], LB: [null, 'Lebanon', 33.9, 35.9],
  AU: [null, 'Australia', -25, 134], EG: [null, 'Egypt', 26.5, 30],
  CD: ['DR Congo', 'Dem. Rep. Congo', -2.9, 23.6], PA: [null, 'Panama', 8.5, -80],
  CH: [null, 'Switzerland', 46.8, 8.2], TR: [null, 'Turkey', 39, 35],
  BR: [null, 'Brazil', -10, -52], HK: ['Hong Kong', null, 22.3, 114.2],
  NZ: [null, 'New Zealand', -41.5, 172.5], DO: ['Dominican Republic', 'Dominican Rep.', 18.8, -70.4],
  SY: [null, 'Syria', 35, 38.5], NP: [null, 'Nepal', 28.2, 84],
  NE: [null, 'Niger', 17, 9], KG: [null, 'Kyrgyzstan', 41.3, 74.8],
  ES: [null, 'Spain', 40, -3.7], MT: ['Malta', null, 35.9, 14.4],
  PH: [null, 'Philippines', 12.5, 122], RS: [null, 'Serbia', 44, 20.9],
  GL: [null, 'Greenland', 72, -40], KP: [null, 'North Korea', 40.2, 127.3],
  NL: [null, 'Netherlands', 52.2, 5.5], EC: [null, 'Ecuador', -1.5, -78.3],
  AT: [null, 'Austria', 47.5, 14.5], IT: [null, 'Italy', 42.8, 12.5],
  DZ: [null, 'Algeria', 28, 2.6], SE: [null, 'Sweden', 62, 15],
  IE: [null, 'Ireland', 53.2, -8], AR: [null, 'Argentina', -35, -65],
  MX: [null, 'Mexico', 23.6, -102.5], TH: [null, 'Thailand', 15.5, 101],
  MA: [null, 'Morocco', 31.8, -7], ZA: [null, 'South Africa', -29, 24.5],
  ET: [null, 'Ethiopia', 9, 39.5], GR: [null, 'Greece', 39.3, 22],
  JM: [null, 'Jamaica', 18.1, -77.3], VA: ['Vatican', null, 41.9, 12.45],
  UN: ['United Nations', null, 40.75, -73.97], // 纽约总部
  HU: [null, 'Hungary', 47.1, 19.4], NG: [null, 'Nigeria', 9.5, 8.1],
  MY: [null, 'Malaysia', 4, 102], MM: [null, 'Myanmar', 21, 96],
  VN: [null, 'Vietnam', 16, 107.8], KH: [null, 'Cambodia', 12.5, 105],
  UG: [null, 'Uganda', 1.3, 32.3], EE: [null, 'Estonia', 58.7, 25.5],
  TJ: [null, 'Tajikistan', 38.8, 71], SK: [null, 'Slovakia', 48.7, 19.7],
  SG: ['Singapore', null, 1.35, 103.8], TW: [null, 'Taiwan', 23.7, 121],
  MH: ['Marshall Islands', null, 7.1, 171.2], BF: [null, 'Burkina Faso', 12.3, -1.6],
  ZW: [null, 'Zimbabwe', -19, 29.8], GH: [null, 'Ghana', 7.9, -1],
  PR: [null, 'Puerto Rico', 18.2, -66.5], SS: ['South Sudan', 'S. Sudan', 7.3, 30],
  SI: [null, 'Slovenia', 46.1, 14.9], SO: [null, 'Somalia', 5.2, 46.2],
  TC: ['Turks and Caicos', null, 21.7, -71.8], BN: [null, 'Brunei', 4.5, 114.7],
  LK: [null, 'Sri Lanka', 7.9, 80.7],
};

export const COUNTRIES: Record<string, Country> = Object.fromEntries(
  Object.entries(C).map(([k, [name, atlas, lat, lon]]) => [k, { name: name ?? atlas ?? k, atlas, lat, lon }])
);

/** 表里没有的代码（backend 的归一化表比这里新）照样显示代码本身，只是没有坐标、上不了地球 */
export const countryName = (code: string) => COUNTRIES[code]?.name ?? code;

export const TOPIC_NAMES: Record<MapTopic, string> = {
  security: 'Conflict & Security',
  tech: 'Tech',
  economy: 'Economy',
  justice: 'Crime & Justice',
  society: 'Society & Rights',
  environment: 'Disasters & Environment',
  culture: 'Religion & Culture',
  sports: 'Sports',
  politics: 'Politics',
};

// 与原型 places.py 的 place() 同口径
const PLACE_MIN = 0.3; // 头号国家占比达到它 → 标在这个国家
const LINK_MIN = 0.15; // 标在一国时，第二国家占比达到它 → 画关联线
const SPREAD_MIN = 0.1; // 没有国家达到 PLACE_MIN 时，占比达到它的国家两两连线

export interface Placement {
  primary: string | null;
  secondary: string | null;
  /** 跨地区：至少两国才算，否则为空 */
  spread: string[];
}

/** places 已按占比降序（契约保证），占比的分母含只写了地区的成员 */
export function place(places: BriefMapEvent['places']): Placement {
  const [first, second] = places;
  const primary = first && first.share >= PLACE_MIN ? first.country : null;
  const secondary = primary && second && second.share >= LINK_MIN ? second.country : null;
  const spread = primary ? [] : places.filter(p => p.share >= SPREAD_MIN).slice(0, 4).map(p => p.country);
  return { primary, secondary, spread: spread.length >= 2 ? spread : [] };
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** 正文块导语（leadHtml）的前两句，纯文本 */
export function leadSentences(leadHtml: string): string {
  const text = leadHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/g, m => ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
  return text.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
}
