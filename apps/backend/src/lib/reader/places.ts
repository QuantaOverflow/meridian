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
  'AL', 'AM', 'AO', 'AZ', 'BA', 'BD', 'BG', 'BI', 'BJ', 'BO', 'BS', 'BT', 'BW', 'BY', 'BZ', 'CF', 'CG', 'CI', 'CL', 'CM',
  'CR', 'CU', 'CV', 'CW', 'CY', 'CZ', 'DJ', 'EH', 'ER', 'FI', 'FJ', 'FK', 'FM', 'GA', 'GD', 'GE', 'GM', 'GN', 'GP', 'GQ',
  'GT', 'GW', 'GY', 'HN', 'HR', 'HT', 'IS', 'KE', 'KZ', 'LA', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'ME', 'MG', 'MK', 'ML',
  'MN', 'MO', 'MR', 'MV', 'MW', 'MZ', 'NA', 'NC', 'NI', 'NR', 'PE', 'PF', 'PG', 'PT', 'PY', 'RO', 'RW', 'SB', 'SD', 'SL',
  'SN', 'SR', 'SV', 'SZ', 'TD', 'TG', 'TL', 'TM', 'TN', 'TT', 'TZ', 'UY', 'UZ', 'VC', 'VU', 'XK', 'ZM',
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
  // 2026-10-04 补齐：上面 world-atlas 新增国家的英文名，与近 30 天生产原值里查不到的州 / 郡 / 城市与地区
  austria: 'AT', 'united states of america': 'US', 'dr congo': 'CD',
  'fiji': 'FJ', 'tanzania': 'TZ', 'western sahara': 'EH', 'kazakhstan': 'KZ', 'uzbekistan': 'UZ',
  'papua new guinea': 'PG', 'chile': 'CL', 'kenya': 'KE', 'sudan': 'SD', 'chad': 'TD', 'haiti': 'HT', 'bahamas': 'BS',
  'falkland islands': 'FK', 'timor-leste': 'TL', 'lesotho': 'LS', 'uruguay': 'UY', 'bolivia': 'BO', 'peru': 'PE',
  'costa rica': 'CR', 'nicaragua': 'NI', 'honduras': 'HN', 'el salvador': 'SV', 'guatemala': 'GT', 'belize': 'BZ',
  'guyana': 'GY', 'suriname': 'SR', 'cuba': 'CU', 'botswana': 'BW', 'namibia': 'NA', 'senegal': 'SN', 'mali': 'ML',
  'mauritania': 'MR', 'benin': 'BJ', 'cameroon': 'CM', 'togo': 'TG', 'côte d\'ivoire': 'CI', 'côte d’ivoire': 'CI',
  'ivory coast': 'CI', 'guinea': 'GN', 'guinea-bissau': 'GW', 'liberia': 'LR', 'sierra leone': 'SL',
  'central african republic': 'CF', 'republic of the congo': 'CG', 'gabon': 'GA', 'equatorial guinea': 'GQ',
  'zambia': 'ZM', 'malawi': 'MW', 'mozambique': 'MZ', 'eswatini': 'SZ', 'angola': 'AO', 'burundi': 'BI',
  'madagascar': 'MG', 'gambia': 'GM', 'tunisia': 'TN', 'vanuatu': 'VU', 'laos': 'LA', 'mongolia': 'MN',
  'bangladesh': 'BD', 'bhutan': 'BT', 'turkmenistan': 'TM', 'armenia': 'AM', 'belarus': 'BY', 'romania': 'RO',
  'lithuania': 'LT', 'latvia': 'LV', 'bulgaria': 'BG', 'albania': 'AL', 'croatia': 'HR', 'luxembourg': 'LU',
  'portugal': 'PT', 'new caledonia': 'NC', 'solomon islands': 'SB', 'iceland': 'IS', 'azerbaijan': 'AZ',
  'georgia': 'GE', 'finland': 'FI', 'czechia': 'CZ', 'eritrea': 'ER', 'paraguay': 'PY', 'cyprus': 'CY', 'libya': 'LY',
  'djibouti': 'DJ', 'rwanda': 'RW', 'bosnia & herzegovina': 'BA', 'bosnia and herzegovina': 'BA', 'macedonia': 'MK',
  'north macedonia': 'MK', 'montenegro': 'ME', 'kosovo': 'XK', 'trinidad and tobago': 'TT', 'trinidad & tobago': 'TT',
  'maldives': 'MV', 'nauru': 'NR', 'cape verde': 'CV', 'grenada': 'GD', 'saint vincent and the grenadines': 'VC',
  'micronesia': 'FM', 'macau': 'MO', 'curaçao': 'CW', 'guadeloupe': 'GP', 'french polynesia': 'PF', 'hawaii': 'US',
  'alaska': 'US', 'ohio': 'US', 'texas': 'US', 'wyoming': 'US', 'oklahoma': 'US', 'kentucky': 'US', 'louisiana': 'US',
  'colorado': 'US', 'iowa': 'US', 'florida': 'US', 'montana': 'US', 'arizona': 'US', 'west virginia': 'US',
  'south dakota': 'US', 'vermont': 'US', 'missouri': 'US', 'nebraska': 'US', 'alabama': 'US', 'maine': 'US',
  'kansas': 'US', 'connecticut': 'US', 'minnesota': 'US', 'north dakota': 'US', 'oregon': 'US', 'michigan': 'US',
  'maryland': 'US', 'delaware': 'US', 'new jersey': 'US', 'wales': 'GB', 'england and wales': 'GB', 'norfolk': 'GB',
  'somerset': 'GB', 'north yorkshire': 'GB', 'essex': 'GB', 'great britain': 'GB', 'jersey': 'GB', 'gujarat': 'IN',
  'bihar': 'IN', 'tasmania': 'AU', 'south australia': 'AU', 'nagoya': 'JP', 'the hague': 'NL', 'newfoundland': 'CA',
  '加拿大': 'CA', 'gaza city': 'PS', 'turkiye': 'TR', 'türkiye': 'TR', 'the gambia': 'GM', 'cabo verde': 'CV',
  'cote d\'ivoire': 'CI', 'czech republic': 'CZ', 'st. vincent and the grenadines': 'VC',
  'federated states of micronesia': 'FM', 'macao': 'MO', 'turks and caicos islands': 'TC', 'swaziland': 'SZ',
  'congo-brazzaville': 'CG', 'holy see': 'VA', 'european union': null, 'world': null, 'earth': null,
  'asia-pacific': null, 'asia': null, 'north america': null, 'arctic': null, 'space': null, 'west indies': null,
  'south pacific': null, 'pacific islands': null, 'asean': null, 'antarctica': null, 'south china sea': null,
  'east asia': null, 'solar system': null, 'pacific': null, 'pacific ocean': null, 'southern africa': null,
  'arabian sea': null, 'mediterranean': null, 'north atlantic': null, 'north atlantic ocean': null,
  'central asia': null, 'caspian sea': null, 'latin america': null, 'nato': null, 'worldwide': null,
  'sub-saharan africa': null, 'canaan': null,
};

/**
 * 归一可能产出的全部国家代码。前端的展示表（apps/frontend/src/lib/briefMap.ts）必须每个都有，
 * 否则该国上不了地球；由前端测试 test/place-tables.test.ts 对照，补表时两边一起补。
 * 国家页（country-blocks.ts）也按它判一个代码是不是认得的国家。
 */
export const PLACE_CODES: ReadonlySet<string> = new Set([
  ...CODES,
  ...Object.values(ALIAS).filter((c): c is string => c !== null),
]);

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

/** 关键实体里有歧义的名字：Georgia 在实体里多半是美国的州，不是国家（2026-10 实测把 FBI 新闻连到了格鲁吉亚） */
const AMBIGUOUS_ENTITY_NAMES = new Set(['georgia']);

/** 关键实体（人名、机构、地名混在一起）→ 国家代码；不是国家、只是地区或有歧义时为 null */
export function countryOfEntity(raw: string): string | null {
  if (AMBIGUOUS_ENTITY_NAMES.has(raw.trim().toLowerCase())) return null;
  const place = normalizePlace(raw);
  return place.kind === 'country' ? place.country : null;
}
