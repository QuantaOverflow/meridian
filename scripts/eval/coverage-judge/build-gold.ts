// ============================================================================
// build-gold —— 三尺共同标注 + 人裁/grounded 定夺 → gold.jsonl
//
// 规则：
//   · 三者(det/judge/codex)三分类完全一致 → gold = 该值（basis=unanimous）
//   · 决策级(covered↔dropped)分歧 18 条 → OVERRIDES 显式定夺（grounded 实体检索坐实 / 人裁）
//   · 仅 headline↔noteworthy 分歧(覆盖侧一致) → gold = 三尺多数（basis=majority-3class；
//     不影响"合成漏报"的 dropped 决策级读数，低风险）
//
// OVERRIDES 每条附 basis：grounded=简报正文实体检索坐实；user=仁慈独裁者裁定。
// 产出 gold.jsonl，每行 {id, gold, basis}。
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import type { Disposition } from './align.js';

// 18 条决策级分歧的定夺（见 session 记录 / disagreements 证据）
const OVERRIDES: Record<string, { gold: Disposition; basis: string }> = {
  // judge=codex=dropped，det 被泛专有名词(Trump/Israeli/World/Netherlands…)误判 covered；
  // 故事独特实体在简报 0 命中，grounded 坐实为真丢弃。
  'admin-brief-1782370673032#S9': { gold: 'dropped', basis: 'grounded: $1.8b anti-weaponisation fund 不在简报(仅Trump泛词)' },
  'admin-brief-1782322639966#S8': { gold: 'dropped', basis: 'grounded: Jabalia/Gaza 空袭不在简报(仅Israeli泛词)' },
  'admin-brief-1782322639966#S12': { gold: 'dropped', basis: 'grounded: Missouri坠机不在简报' },
  'admin-brief-1782322639966#S13': { gold: 'dropped', basis: 'grounded: 荷日2-2那场不在简报(Netherlands指教练泛提)' },
  'admin-brief-1782204768600#S7': { gold: 'dropped', basis: 'grounded: Lucknow火灾仅元评论脚注,非覆盖' },
  'admin-brief-1782204768600#S9': { gold: 'dropped', basis: 'grounded: 菲律宾校园枪击不在简报' },
  'admin-brief-1781007434068#S13': { gold: 'dropped', basis: 'grounded: 性暴力报告不在简报(仅Israeli泛词)' },
  'admin-brief-1780662961660#S11': { gold: 'dropped', basis: 'grounded: Bolton认罪全0命中' },
  'admin-brief-1780662961660#S13': { gold: 'dropped', basis: 'grounded: A3C拉美不在简报(仅Trump泛词)' },
  'admin-brief-1780662961660#S14': { gold: 'dropped', basis: 'grounded: Andy Burnham不在简报' },
  'admin-brief-1780554095183#S8': { gold: 'dropped', basis: 'grounded: Bakersfield人质不在简报' },
  'admin-brief-1780554095183#S12': { gold: 'dropped', basis: 'grounded: CBS/Pelley不在简报' },
  'admin-brief-1780494276570#S9': { gold: 'dropped', basis: 'grounded: FIFA主办城市LA安全不在简报' },
  'admin-brief-1780494276570#S15': { gold: 'dropped', basis: 'grounded: $1.776b基金废止不在简报' },
  // judge=codex 一致 covered，det 漏配 → grounded 坐实覆盖
  'admin-brief-1782322639966#S7': { gold: 'noteworthy', basis: 'grounded: 简报noteworthy有"lithium-ion battery fire in Rio/Two helicopters"' },
  'admin-brief-1780494276570#S13': { gold: 'headline', basis: 'grounded: 简报有headline块"EU...Returns Regulation"' },
  // judge↔codex 真分裂 → 人裁（仁慈独裁者）
  'admin-brief-1780662961660#S12': { gold: 'noteworthy', basis: 'user: 简报"the Senate immigration bill revolt"折叠提及算noteworthy' },
  'admin-brief-1780036335731#S7': { gold: 'dropped', basis: 'user: 简报只提"Lebanon停火法律地位",非空袭升级本事件→dropped' },
};

function majority(votes: Disposition[]): Disposition {
  const c: Record<string, number> = {};
  for (const v of votes) c[v] = (c[v] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] as Disposition;
}

const colabel = readFileSync('colabel.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const out: any[] = [];
for (const r of colabel) {
  const votes = [r.det, r.judge, r.codex] as Disposition[];
  if (OVERRIDES[r.id]) {
    out.push({ id: r.id, gold: OVERRIDES[r.id].gold, basis: OVERRIDES[r.id].basis });
  } else if (new Set(votes).size === 1) {
    out.push({ id: r.id, gold: votes[0], basis: 'unanimous' });
  } else {
    // 仅 headline↔noteworthy 分歧（覆盖侧一致）→ 三尺多数
    out.push({ id: r.id, gold: majority(votes), basis: 'majority-3class(covered侧一致,不影响dropped决策)' });
  }
}

writeFileSync('gold.jsonl', out.map((r) => JSON.stringify(r)).join('\n') + '\n');
const n = (d: string) => out.filter((r) => r.gold === d).length;
const byBasis: Record<string, number> = {};
for (const r of out) byBasis[r.basis.split(':')[0].split('(')[0]] = (byBasis[r.basis.split(':')[0].split('(')[0]] ?? 0) + 1;
console.log(`✅ gold.jsonl（${out.length}）: headline ${n('headline')} / noteworthy ${n('noteworthy')} / dropped ${n('dropped')}`);
console.log('  basis 分布:', byBasis);
