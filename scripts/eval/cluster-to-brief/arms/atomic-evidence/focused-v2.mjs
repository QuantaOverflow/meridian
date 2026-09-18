import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { loadCluster } from '../../lib.mjs';
import {
  assignAtomIds,
  atomicWriteJson,
  atomicizerPrompt,
  atomCoverage,
  atomsOk,
  atomSchemaFor,
  chatJson,
  gateOk,
  gatePrompt,
  gateSchema,
  normalizeAtoms,
  sanitizeGateOutput,
  scoreProbe,
} from './probe.mjs';
import { loadSlateCases } from './slate.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = `${ROOT}out/atomic-evidence`;
const ATOM_VERSION = 'focused-v4';
const GATE_VERSION = 'focused-v5';
const REFS = ['b1s3', 'b1s10', 'b2s4', 'b2s6', 'b2s7', 'b2s8', 'b3s8', 'b3s10'];

export function loadFocusedCases() {
  const byRef = new Map(loadSlateCases().map(item => [item.ref, item]));
  return REFS.map(ref => {
    const item = byRef.get(ref);
    if (!item) throw new Error(`missing focused case ${ref}`);
    return item;
  });
}

export function makeAtomUnits(cases, atomized) {
  return atomized.items.flatMap((item, parentIndex) =>
    item.atoms.map(atom => ({
      parentRef: item.parentRef,
      cases: [cases[parentIndex]],
      atomized: { items: [{ parentRef: item.parentRef, atoms: [atom] }] },
    }))
  );
}

async function main() {
  const resume = process.argv.includes('--resume');
  const atomsOnly = process.argv.includes('--atoms-only');
  const cases = loadFocusedCases();
  const cluster = loadCluster(36);
  const callsPath = `${OUT}/calls.jsonl`;
  const atomDir = `${OUT}/${ATOM_VERSION}-atoms`;
  const atomPath = `${OUT}/${ATOM_VERSION}-atoms.json`;
  mkdirSync(atomDir, { recursive: true });

  const atomParts = [];
  for (const candidate of cases) {
    const partPath = `${atomDir}/${candidate.ref}.json`;
    let part;
    if (resume && existsSync(partPath)) {
      part = JSON.parse(readFileSync(partPath, 'utf8'));
      if (!atomsOk(part, [candidate])) throw new Error(`cached atoms invalid for ${candidate.ref}`);
      console.log(`[${ATOM_VERSION}-atom-${candidate.ref}] reused`);
    } else {
      const raw = await chatJson(
        `${ATOM_VERSION}-atom-${candidate.ref}`,
        atomicizerPrompt([candidate]),
        atomSchemaFor([candidate]),
        value => atomsOk(value, [candidate]),
        callsPath
      );
      part = assignAtomIds(normalizeAtoms(raw, [candidate]));
      atomicWriteJson(partPath, part);
    }
    atomParts.push(part);
  }
  const atomized = { items: atomParts.flatMap(part => part.items) };
  atomicWriteJson(atomPath, atomized);

  const coverage = cases.map((candidate, i) => ({
    ref: candidate.ref,
    ...atomCoverage(candidate.text, atomized.items[i].atoms),
  }));
  atomicWriteJson(`${OUT}/${ATOM_VERSION}-coverage.json`, coverage);
  for (const row of coverage)
    console.log(
      `coverage ${row.ref} ${(row.ratio * 100).toFixed(1)}%${row.missing.length ? ` missing=${row.missing.join(',')}` : ''}`
    );
  if (atomsOnly) return;
  const coverageSafe = coverage.every(row => row.ratio >= 0.9);
  if (!coverageSafe) throw new Error('atomicization coverage below 90%; evidence gating is unsafe');

  const gateDir = `${OUT}/${GATE_VERSION}-gates`;
  mkdirSync(gateDir, { recursive: true });
  const gateParts = [];
  const units = makeAtomUnits(cases, atomized);
  for (const [unitIndex, unit] of units.entries()) {
    const atom = unit.atomized.items[0].atoms[0];
    const partPath = `${gateDir}/${atom.atomId}.json`;
    let part;
    if (resume && existsSync(partPath)) {
      part = JSON.parse(readFileSync(partPath, 'utf8'));
      if (!gateOk(part, unit.atomized, unit.cases)) throw new Error(`cached gate invalid for ${atom.atomId}`);
      console.log(`[${GATE_VERSION}-gate-${unitIndex + 1}/${units.length}] reused ${atom.atomId}`);
    } else {
      const raw = await chatJson(
        `${GATE_VERSION}-gate-${atom.atomId}`,
        gatePrompt(unit.cases, unit.atomized, cluster),
        gateSchema,
        value => gateOk(sanitizeGateOutput(value, unit.atomized), unit.atomized, unit.cases),
        callsPath
      );
      part = sanitizeGateOutput(raw, unit.atomized);
      atomicWriteJson(partPath, part);
    }
    gateParts.push(part);
  }

  const gated = { results: gateParts.flatMap(part => part.results) };
  atomicWriteJson(`${OUT}/${GATE_VERSION}-gates.json`, gated);
  const score = scoreProbe(cases, atomized, gated, cluster);
  const result = { ...score, pass: score.pass && coverageSafe, coverageSafe, coverage };
  atomicWriteJson(`${OUT}/${GATE_VERSION}-score.json`, result);
  console.log(
    `${GATE_VERSION} ${result.pass ? 'PASS' : 'FAIL'} parents=${cases.length} atoms=${units.length} coverageSafe=${coverageSafe}`
  );
  process.exitCode = result.pass ? 0 : 1;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 2;
  });
}
