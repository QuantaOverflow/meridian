import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { loadCluster } from '../../lib.mjs';
import { chatJson, gateOk, gatePrompt, gateSchema, sanitizeGateOutput, verdictOf } from './probe.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = `${ROOT}out/atomic-evidence`;

// Minimal pairs isolate dimensions that were bundled inside the four real hard-error sentences.
// They are paraphrases of the same frozen c36 claims/evidence, not new fixture knowledge.
export const EDGE_CASES = [
  {
    ref: 'wrong-attribution',
    expected: 'unsupported',
    text: 'Iranian state media reported that an oil tanker struck a sea mine and exploded in the Strait of Hormuz.',
    sources: [{ articleId: 1002754, sentence: 1 }],
  },
  {
    ref: 'right-attribution',
    expected: 'supported',
    text: 'Iran’s Islamic Revolutionary Guard Corps said that an oil tanker struck a sea mine and exploded in the Strait of Hormuz.',
    sources: [{ articleId: 1002754, sentence: 1 }],
  },
  {
    ref: 'missing-identity',
    expected: 'unsupported',
    text: 'The tanker El Gaia struck a sea mine and exploded in the Strait of Hormuz.',
    sources: [{ articleId: 1002754, sentence: 1 }],
  },
  {
    ref: 'generic-identity',
    expected: 'supported',
    text: 'An oil tanker struck a sea mine and exploded in the Strait of Hormuz.',
    sources: [{ articleId: 1002754, sentence: 1 }],
  },
  {
    ref: 'stronger-action',
    expected: 'unsupported',
    text: 'Saudi Arabia’s East-West oil pipeline was temporarily shut by a drone attack.',
    sources: [{ articleId: 996847, sentence: 19 }],
  },
  {
    ref: 'matched-action',
    expected: 'supported',
    text: 'Saudi Arabia’s East-West oil pipeline was damaged in a drone attack.',
    sources: [{ articleId: 996847, sentence: 19 }],
  },
  {
    ref: 'missing-origin',
    expected: 'unsupported',
    text: 'The drone attack that damaged Saudi Arabia’s East-West oil pipeline originated from Iraq.',
    sources: [{ articleId: 996847, sentence: 19 }],
  },
  {
    ref: 'composite-action-origin',
    expected: 'unsupported',
    text: "Saudi Arabia's East-West oil pipeline was temporarily shut by a drone attack originating from Iraq.",
    sources: [{ articleId: 996847, sentence: 20 }],
  },
  {
    ref: 'composite-attribution-identity',
    expected: 'unsupported',
    text: 'Iranian state media reported that the tanker El Gaia struck a sea mine and exploded in the Strait of Hormuz.',
    sources: [{ articleId: 1002754, sentence: 1 }],
  },
];

function atomicWriteJson(path, value) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { flag: 'wx' });
  renameSync(tmp, path);
}

export function buildEdgeAtoms() {
  return {
    items: EDGE_CASES.map(c => ({
      parentRef: c.ref,
      atoms: [{ atomId: `${c.ref}a1`, text: c.text, sourceIndexes: [1] }],
    })),
  };
}

export function scoreEdgeCases(gated) {
  const resultById = new Map(gated.results.map(x => [x.atomId, x]));
  const results = EDGE_CASES.map(c => {
    const result = resultById.get(`${c.ref}a1`);
    const actual = verdictOf(result);
    const pass = c.expected === 'supported' ? actual === 'supported' : actual !== 'supported';
    return {
      ref: c.ref,
      expected: c.expected,
      actual,
      pass,
      unsupportedSpans: result.unsupportedSpans,
      uncertainSpans: result.uncertainSpans,
      reason: result.reason,
    };
  });
  return { pass: results.every(x => x.pass), results };
}

async function main() {
  const replay = process.argv.includes('--replay');
  mkdirSync(OUT, { recursive: true });
  const path = `${OUT}/c36-gate-edgecases-v4.json`;
  const atoms = buildEdgeAtoms();
  const cluster = loadCluster(36);
  let gated;
  if (replay) {
    if (!existsSync(path)) throw new Error('replay requires cached edge-case output');
    gated = JSON.parse(readFileSync(path, 'utf8'));
    if (!gateOk(gated, atoms, EDGE_CASES)) throw new Error('cached edge-case output is invalid');
  } else {
    const raw = await chatJson(
      'c36-gate-edgecases',
      gatePrompt(EDGE_CASES, atoms, cluster),
      gateSchema,
      x => gateOk(sanitizeGateOutput(x, atoms), atoms, EDGE_CASES),
      `${OUT}/calls.jsonl`
    );
    gated = sanitizeGateOutput(raw, atoms);
    atomicWriteJson(path, gated);
  }
  const score = scoreEdgeCases(gated);
  atomicWriteJson(`${OUT}/c36-gate-edgecases-score-v4.json`, score);
  for (const row of score.results)
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.ref}: expected=${row.expected} actual=${row.actual}`);
  console.log(`edge cases ${score.pass ? 'PASS' : 'FAIL'}`);
  process.exitCode = score.pass ? 0 : 1;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  main().catch(e => {
    console.error(e);
    process.exitCode = 2;
  });
}
