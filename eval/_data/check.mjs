#!/usr/bin/env node
/**
 * 金标包校验：每份 eval/_data/<set>/ 必须自解释，缺一项即非零退出。
 *
 * 为什么要这个脚本：2026-09-22 判断 intel-grounding 能不能留、faithfulness 该不该删，
 * 靠的是人去 head 文件、数证据覆盖率、翻 rubric 看它引用了谁。那次判对了，但下次未必
 * 有人愿意翻。这些问题全都可判定，所以换成 exit code。
 *
 * 跑法：node eval/_data/check.mjs
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const TARGET_OF = ['product', 'judge'];
const EVIDENCE_MODE = ['snapshot', 'rebuildable'];
// raw_source：外部素材（原始文章等），换架构仍有效，长期保留。
// retired_intermediate：系统的中间产物，架构一变即废——允许存在，但必须自己标出来，
//   因为它决定了这份金标是资产还是消耗品。
const EVIDENCE_KIND = ['raw_source', 'retired_intermediate'];

const problems = [];
const summary = [];

const sets = readdirSync(HERE)
  .filter(n => !n.startsWith('.') && statSync(join(HERE, n)).isDirectory())
  .sort();

if (!sets.length) {
  console.error('eval/_data/ 下一个金标包都没有');
  process.exit(1);
}

for (const set of sets) {
  const dir = join(HERE, set);
  const fail = msg => problems.push(`${set}: ${msg}`);

  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    fail('缺 manifest.json —— 没有它，这份金标能不能用只能靠人翻文件推断');
    continue;
  }

  let m;
  try {
    m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    fail(`manifest.json 不是合法 JSON：${e.message}`);
    continue;
  }

  if (m.id !== set) fail(`manifest.id 是 ${JSON.stringify(m.id)}，与目录名 ${set} 不一致`);

  if (!TARGET_OF.includes(m.targetOf)) {
    fail(`targetOf 必须是 ${TARGET_OF.join(' / ')}，收到 ${JSON.stringify(m.targetOf)}` +
      ' —— 缺了它，没有任何东西拦得住把判官成绩当产品成绩报');
  }

  // 标签文件与条数
  const labelsFile = m.labels || 'labels.jsonl';
  const labelsPath = join(dir, labelsFile);
  if (!existsSync(labelsPath)) {
    fail(`manifest 指的标签文件 ${labelsFile} 不存在`);
  } else if (labelsFile.endsWith('.jsonl')) {
    const rows = readFileSync(labelsPath, 'utf8').trim().split('\n').filter(Boolean);
    if (typeof m.cases === 'number' && m.cases !== rows.length) {
      fail(`manifest.cases=${m.cases}，但 ${labelsFile} 实际 ${rows.length} 行`);
    }
    // labelBalance 与实际标签对账。κ 只有配上正负比例才能解释，所以这个数不许手填错。
    if (m.labelBalance) {
      const actual = {};
      for (const line of rows) {
        let r;
        try { r = JSON.parse(line); } catch { fail(`${labelsFile} 有一行不是合法 JSON`); break; }
        const v = r.gold ?? r.verdict ?? r.label;
        if (v === undefined) { fail(`${labelsFile} 有一行没有 gold / verdict / label 字段`); break; }
        actual[v] = (actual[v] || 0) + 1;
      }
      const a = JSON.stringify(actual, Object.keys(actual).sort());
      const d = JSON.stringify(m.labelBalance, Object.keys(m.labelBalance).sort());
      if (a !== d) fail(`labelBalance 对不上实际标签：manifest ${d}，实际 ${a}`);
    }
  }

  if (!m.labelBalance) {
    fail('缺 labelBalance —— 样本不平衡时判官把少数类全判错也能拿高一致率，' +
      '单看 κ / agreement 无法解释');
  }

  // 证据
  const ev = m.evidence;
  if (!ev || typeof ev !== 'object') {
    fail('缺 evidence —— 判定是相对证据成立的，证据没了判定就无法复现');
  } else {
    if (!EVIDENCE_MODE.includes(ev.mode)) {
      fail(`evidence.mode 必须是 ${EVIDENCE_MODE.join(' / ')}，收到 ${JSON.stringify(ev.mode)}`);
    }
    if (!EVIDENCE_KIND.includes(ev.kind)) {
      fail(`evidence.kind 必须是 ${EVIDENCE_KIND.join(' / ')}，收到 ${JSON.stringify(ev.kind)}`);
    }
    if (ev.mode === 'snapshot') {
      if (!ev.file) fail('evidence.mode=snapshot 但没写 evidence.file');
      else if (!existsSync(join(dir, ev.file))) fail(`证据快照 ${ev.file} 不存在`);
    }
    if (ev.mode === 'rebuildable' && !ev.rebuild) {
      fail('evidence.mode=rebuildable 但没写 evidence.rebuild（重建命令）');
    }
  }

  // rubric 必须存在且自包含
  const rubricPath = join(dir, 'rubric.md');
  if (!existsSync(rubricPath)) {
    fail('缺 rubric.md —— 没有标注规范，标签就是一堆无法解释的字符串');
  } else {
    const text = readFileSync(rubricPath, 'utf8');
    // 跨目录引用会断：那个目录的存亡由它自己的 harness 决定，与本金标无关。
    const crossRefs = [...text.matchAll(/\.\.\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+/g)].map(x => x[0]);
    const outside = crossRefs.filter(r => !r.startsWith('../_data/'));
    if (outside.length) {
      fail(`rubric.md 跨目录引用了 ${[...new Set(outside)].join(' / ')} —— ` +
        'rubric 必须自包含，被引的目录随时可能随 harness 一起删掉');
    }
  }

  summary.push(`  ${set.padEnd(24)} targetOf=${m.targetOf ?? '?'}  ` +
    `cases=${m.cases ?? '?'}  evidence=${ev?.kind ?? '?'}/${ev?.mode ?? '?'}`);
}

console.log(`金标包 ${sets.length} 份：`);
console.log(summary.join('\n'));

if (problems.length) {
  console.error(`\n不合规 ${problems.length} 条：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n全部合规。');
