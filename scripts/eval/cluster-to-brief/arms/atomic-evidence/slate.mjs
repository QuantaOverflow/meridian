import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { loadCluster } from '../../lib.mjs';
import {
  assignAtomIds,
  atomicWriteJson,
  atomicizerPrompt,
  atomsOk,
  atomSchemaFor,
  chatJson,
  flattenBrief,
  gateOk,
  gatePrompt,
  gateSchema,
  makeGateUnits,
  normalizeAtoms,
  sanitizeGateOutput,
  scoreProbe,
} from './probe.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = `${ROOT}out/atomic-evidence`;
const SLATE_OUT = `${ROOT}out/atomic-evidence-slate`;
const DIRECT = `${ROOT}out/direct-raw/c36.json`;
const HARD_REFS = new Set(['b2s4', 'b2s6', 'b2s8', 'b3s10']);
const ATOM_PARENT_BATCH = 8;

export function loadSlateCases() {
  return flattenBrief(JSON.parse(readFileSync(DIRECT, 'utf8'))).map(row => ({
    ref: row.ref,
    expected: HARD_REFS.has(row.ref) ? 'mixed' : 'supported',
    text: row.text,
    sources: row.sources,
  }));
}

export function buildVerifiedSlate(brief, score) {
  const byRef = new Map(score.results.map(x => [x.ref, x]));
  return {
    ...brief,
    blocks: brief.blocks.map((block, bi) => ({
      ...block,
      sentences: block.sentences.flatMap((sentence, si) => {
        const ref = `b${bi + 1}s${si + 1}`;
        const row = byRef.get(ref);
        if (!row) throw new Error(`missing slate score for ${ref}`);
        return row.atoms.filter(a => a.verdict === 'supported').map(a => ({ text: a.text, sources: a.sources }));
      }),
    })),
  };
}

async function main() {
  const replay = process.argv.includes('--replay');
  const resume = process.argv.includes('--resume');
  mkdirSync(OUT, { recursive: true });
  mkdirSync(SLATE_OUT, { recursive: true });
  const callsPath = `${OUT}/calls.jsonl`;
  const cases = loadSlateCases();
  const cluster = loadCluster(36);

  const atomDir = `${OUT}/c36-slate-atoms`;
  const atomPath = `${OUT}/c36-slate-atoms.json`;
  mkdirSync(atomDir, { recursive: true });
  let atomized;
  if (replay) {
    atomized = JSON.parse(readFileSync(atomPath, 'utf8'));
    if (!atomsOk(atomized, cases)) throw new Error('cached slate atoms are invalid');
  } else {
    const parts = [];
    for (let start = 0; start < cases.length; start += ATOM_PARENT_BATCH) {
      const batch = cases.slice(start, start + ATOM_PARENT_BATCH);
      const partPath = `${atomDir}/b${parts.length + 1}.json`;
      let part;
      if (resume && existsSync(partPath)) {
        part = JSON.parse(readFileSync(partPath, 'utf8'));
        if (!atomsOk(part, batch)) throw new Error(`cached atom batch ${parts.length + 1} is invalid`);
        console.log(`[c36-slate-atom-b${parts.length + 1}] reused`);
      } else {
        const schema = atomSchemaFor(batch);
        const raw = await chatJson(
          `c36-slate-atom-b${parts.length + 1}`,
          atomicizerPrompt(batch),
          schema,
          x => atomsOk(x, batch),
          callsPath
        );
        part = assignAtomIds(normalizeAtoms(raw, batch));
        atomicWriteJson(partPath, part);
      }
      parts.push(part);
    }
    atomized = { items: parts.flatMap(x => x.items) };
    if (!atomsOk(atomized, cases)) throw new Error('combined slate atoms are invalid');
    atomicWriteJson(atomPath, atomized);
  }

  const gateDir = `${OUT}/c36-slate-gates`;
  const gatePath = `${OUT}/c36-slate-gates.json`;
  mkdirSync(gateDir, { recursive: true });
  let gated;
  if (replay) {
    gated = JSON.parse(readFileSync(gatePath, 'utf8'));
    if (!gateOk(gated, atomized, cases)) throw new Error('cached slate gates are invalid');
  } else {
    const parts = [];
    for (const unit of makeGateUnits(cases, atomized)) {
      const partPath = `${gateDir}/u${parts.length + 1}.json`;
      let part;
      if (resume && existsSync(partPath)) {
        part = JSON.parse(readFileSync(partPath, 'utf8'));
        if (!gateOk(part, unit.atomized, unit.cases))
          throw new Error(`cached gate unit ${parts.length + 1} is invalid`);
        console.log(`[c36-slate-gate-u${parts.length + 1}] reused`);
      } else {
        const raw = await chatJson(
          `c36-slate-gate-u${parts.length + 1}`,
          gatePrompt(unit.cases, unit.atomized, cluster),
          gateSchema,
          x => gateOk(sanitizeGateOutput(x, unit.atomized), unit.atomized, unit.cases),
          callsPath
        );
        part = sanitizeGateOutput(raw, unit.atomized);
        atomicWriteJson(partPath, part);
      }
      parts.push(part);
    }
    gated = { results: parts.flatMap(x => x.results) };
    if (!gateOk(gated, atomized, cases)) throw new Error('combined slate gates are invalid');
    atomicWriteJson(gatePath, gated);
  }

  const score = scoreProbe(cases, atomized, gated, cluster);
  atomicWriteJson(`${OUT}/c36-slate-score.json`, score);
  const brief = buildVerifiedSlate(JSON.parse(readFileSync(DIRECT, 'utf8')), score);
  atomicWriteJson(`${SLATE_OUT}/c36.json`, brief);
  console.log(
    `slate ${score.pass ? 'PASS' : 'FAIL'} parents=${cases.length} atoms=${atomized.items.flatMap(x => x.atoms).length}`
  );
  console.log(`controls rejected=${score.results.filter(x => x.expected === 'supported' && x.rejected > 0).length}`);
  process.exitCode = score.pass ? 0 : 1;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  main().catch(e => {
    console.error(e);
    process.exitCode = 2;
  });
}
