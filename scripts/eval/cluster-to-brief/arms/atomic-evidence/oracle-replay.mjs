import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = `${ROOT}out/atomic-evidence`;
const DIRECT_BRIEF = `${ROOT}out/direct-raw/c36.json`;
const DIRECT_VERDICT = `${ROOT}out/direct-raw/verdict-c36.json`;
const PROBE_SCORE = `${OUT}/c36-probe-score-v6.json`;
const HARD_REFS = new Set(['b2s4', 'b2s6', 'b2s8', 'b3s10']);

function atomicWriteJson(path, value) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { flag: 'wx' });
  renameSync(tmp, path);
}

function refsIn(where) {
  return String(where ?? '').match(/b\d+s\d+/g) ?? [];
}

export function buildOracleReplay(brief, oldVerdict, probeScore) {
  const probeByRef = new Map(probeScore.results.map(x => [x.ref, x]));
  const replacementCounts = {};
  const blocks = brief.blocks.map((block, bi) => {
    const sentences = [];
    for (const [si, sentence] of block.sentences.entries()) {
      const ref = `b${bi + 1}s${si + 1}`;
      if (!HARD_REFS.has(ref)) {
        sentences.push(sentence);
        continue;
      }
      const probe = probeByRef.get(ref);
      if (!probe) throw new Error(`missing probe result for ${ref}`);
      const admitted = probe.atoms
        .filter(a => a.verdict === 'supported')
        .map(a => ({ text: a.text, sources: a.sources }));
      replacementCounts[ref] = admitted.length;
      sentences.push(...admitted);
    }
    return { ...block, sentences };
  });

  const coreRows = oldVerdict.coverage.slice(0, 7).map(row => {
    const refs = refsIn(row.where);
    const unaffectedRefs = refs.filter(ref => !HARD_REFS.has(ref));
    return {
      eventId: row.eventId,
      oldCovered: row.covered,
      oldWhere: row.where,
      conservativelyRetained: row.covered && unaffectedRefs.length > 0,
      unaffectedRefs,
    };
  });
  const conservativeCoreHit = coreRows.filter(x => x.conservativelyRetained).length;
  return {
    brief: { ...brief, blocks },
    summary: {
      kind: 'oracle_counterfactual_not_independent_slow_judgement',
      hardParents: [...HARD_REFS],
      replacementCounts,
      oldCoreHit: oldVerdict.coverage.slice(0, 7).filter(x => x.covered).length,
      conservativeCoreHit,
      coreOf: 7,
      coreRows,
      caveat:
        'Unchanged sentences inherit the frozen slow verdict only for this counterfactual. Run a fresh slow judgement before claiming an arm pass.',
    },
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const result = buildOracleReplay(
    JSON.parse(readFileSync(DIRECT_BRIEF, 'utf8')),
    JSON.parse(readFileSync(DIRECT_VERDICT, 'utf8')),
    JSON.parse(readFileSync(PROBE_SCORE, 'utf8'))
  );
  atomicWriteJson(`${OUT}/c36.json`, result.brief);
  atomicWriteJson(`${OUT}/c36-oracle-replay-summary.json`, result.summary);
  console.log(
    `oracle replay: core conservatively retained ${result.summary.conservativeCoreHit}/${result.summary.coreOf}`
  );
  console.log(`replacements: ${JSON.stringify(result.summary.replacementCounts)}`);
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  main().catch(e => {
    console.error(e);
    process.exitCode = 2;
  });
}
