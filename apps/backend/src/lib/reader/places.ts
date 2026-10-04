/**
 * articles.primary_location 原值 → ISO 3166-1 alpha-2（联合国为 `UN`）。地图（brief-map.ts）用。
 *
 * 原值很乱（`USA` / `United States`、美国各州、十几种尼泊尔–西藏写法），所以要归一。表从地图原型的
 * places.py 搬来（2026-09-29 的 111 期跑过：532 篇全部落表）；国家名、坐标、底图名是展示，在前端。
 * 表里没有的值由调用方计入 unmapped 并记日志，看到日志再补表。
 */

/** 原型国家表的 key：原值本身就是这些代码（大小写不论）时直接认 */
const CODES = new Set([
  'US', 'IR', 'UA', 'RU', 'PL', 'CA', 'NO', 'FR', 'MD', 'KR', 'BE', 'DE', 'DK', 'GB', 'JP', 'CO', 'VE', 'AE', 'QA', 'JO',
  'SA', 'OM', 'PK', 'BH', 'YE', 'IN', 'CN', 'IQ', 'KW', 'AF', 'PS', 'IL', 'ID', 'LB', 'AU', 'EG', 'CD', 'PA', 'CH', 'TR',
  'BR', 'HK', 'NZ', 'DO', 'SY', 'NP', 'NE', 'KG', 'ES', 'MT', 'PH', 'RS', 'GL', 'KP', 'NL', 'EC', 'AT', 'IT', 'DZ', 'SE',
  'IE', 'AR', 'MX', 'TH', 'MA', 'ZA', 'ET', 'GR', 'JM', 'VA', 'UN', 'HU', 'NG', 'MY', 'MM', 'VN', 'KH', 'UG', 'EE', 'TJ',
  'SK', 'SG', 'TW', 'MH', 'BF', 'ZW', 'GH', 'PR', 'SS', 'SI', 'SO', 'TC', 'BN', 'LK',
]);

/** 原值（去首尾空白、小写）→ 国家代码；null = 只写了地区或组织，落不到单一国家 */
const ALIAS: Record<string, string | null> = {
  'united states': 'US', usa: 'US', massachusetts: 'US', mississippi: 'US',
  iran: 'IR', irn: 'IR', ukraine: 'UA', russia: 'RU', poland: 'PL',
  canada: 'CA', can: 'CA', norway: 'NO', france: 'FR', moldova: 'MD',
  'south korea': 'KR', belgium: 'BE', germany: 'DE', denmark: 'DK',
  uk: 'GB', 'united kingdom': 'GB', england: 'GB', 'northern ireland': 'GB',
  'clacton, essex, uk': 'GB', 'uk and france': 'GB', 'france and united kingdom': 'FR',
  japan: 'JP', colombia: 'CO', venezuela: 'VE', uae: 'AE', 'united arab emirates': 'AE',
  qatar: 'QA', jordan: 'JO', 'saudi arabia': 'SA', oman: 'OM', pakistan: 'PK',
  bahrain: 'BH', yemen: 'YE', india: 'IN', china: 'CN', tibet: 'CN', 'tibet, china': 'CN',
  iraq: 'IQ', kuwait: 'KW', afghanistan: 'AF',
  'west bank': 'PS', 'occupied west bank': 'PS', palestine: 'PS', gaza: 'PS', 'gaza strip': 'PS',
  israel: 'IL', indonesia: 'ID', lebanon: 'LB', australia: 'AU', egypt: 'EG',
  'democratic republic of the congo': 'CD', 'democratic republic of congo': 'CD', congo: 'CD',
  panama: 'PA', switzerland: 'CH', turkey: 'TR', brazil: 'BR', 'hong kong': 'HK',
  'new zealand': 'NZ', 'dominican republic': 'DO', syria: 'SY', nepal: 'NP',
  'nepal and tibet': 'NP', 'china-nepal border': 'NP', 'nepal-tibet border': 'NP', 'nepal-tibet': 'NP',
  'nepal and china': 'NP', 'tibet, china/nepal': 'NP', 'nepal and china’s tibet': 'NP',
  'china/nepal': 'NP', 'tibet-nepal border': 'NP', 'nepal-china border': 'NP', 'nepal and tibet, china': 'NP',
  niger: 'NE', kyrgyzstan: 'KG', spain: 'ES', malta: 'MT', philippines: 'PH',
  serbia: 'RS', greenland: 'GL', 'north korea': 'KP', netherlands: 'NL', ecuador: 'EC',
  vienna: 'AT', italy: 'IT', algeria: 'DZ', sweden: 'SE', ireland: 'IE',
  argentina: 'AR', mexico: 'MX', thailand: 'TH', morocco: 'MA', 'south africa': 'ZA',
  ethiopia: 'ET', greece: 'GR', jamaica: 'JM', vatican: 'VA', 'vatican city': 'VA',
  hungary: 'HU', nigeria: 'NG',
  europe: null, 'middle east': null, gulf: null, 'gulf region': null, 'gulf nations': null,
  global: null, 'united nations': 'UN', africa: null, 'south america': null,
  caribbean: null, 'nordic nations': null,
  malaysia: 'MY', myanmar: 'MM', vietnam: 'VN', cambodia: 'KH', uganda: 'UG',
  estonia: 'EE', tajikistan: 'TJ', slovakia: 'SK', singapore: 'SG', taiwan: 'TW',
  'marshall islands': 'MH', 'burkina faso': 'BF', zimbabwe: 'ZW', ghana: 'GH',
  'puerto rico': 'PR', 'south sudan': 'SS', slovenia: 'SI', somalia: 'SO',
  'turks and caicos': 'TC', brunei: 'BN', 'sri lanka': 'LK', scotland: 'GB',
  illinois: 'US', 'north carolina': 'US', tennessee: 'US', california: 'US', wisconsin: 'US',
  'south carolina': 'US', 'new hampshire': 'US', pennsylvania: 'US', 'southeast asia': null,
};

/** 归一结果：国家代码 / 地区或组织（不落国家）/ 表里没有或空值 */
type Place = { kind: 'country'; country: string } | { kind: 'regional' } | { kind: 'unmapped' };

export function normalizePlace(raw: string | null): Place {
  const key = (raw ?? '').trim();
  if (key === '') return { kind: 'unmapped' };
  // hasOwn：原值是 `constructor` 这类字样时不能取到原型链上的东西
  const alias = Object.hasOwn(ALIAS, key.toLowerCase()) ? ALIAS[key.toLowerCase()] : undefined;
  if (alias === null) return { kind: 'regional' };
  if (alias !== undefined) return { kind: 'country', country: alias };
  if (CODES.has(key.toUpperCase())) return { kind: 'country', country: key.toUpperCase() };
  return { kind: 'unmapped' };
}
