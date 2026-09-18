import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { loadCluster, numbersIn, sentenceOf } from '../../lib.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = `${ROOT}out/atomic-evidence`;
const DIRECT = `${ROOT}out/direct-raw/c36.json`;
const ENDPOINT = process.env.AI_WORKER_URL ?? 'http://localhost:8787/meridian/chat';
const MODEL = process.env.ATOMIC_EVIDENCE_MODEL ?? '@cf/zai-org/glm-4.7-flash';

export const CASES = [
  { ref: 'b2s4', expected: 'mixed' },
  { ref: 'b2s6', expected: 'mixed' },
  { ref: 'b2s8', expected: 'mixed' },
  { ref: 'b3s10', expected: 'mixed' },
  { ref: 'b1s1', expected: 'supported' },
  { ref: 'b2s2', expected: 'supported' },
  { ref: 'b2s9', expected: 'supported' },
  { ref: 'b3s5', expected: 'supported' },
];

function argsOf(argv) {
  return Object.fromEntries(
    argv.map(x => {
      const m = /^--([^=]+)=?(.*)$/.exec(x);
      return m ? [m[1], m[2] === '' ? true : m[2]] : [x, true];
    })
  );
}

export function atomicWriteJson(path, value) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { flag: 'wx' });
  renameSync(tmp, path);
}

export function flattenBrief(doc) {
  const rows = [];
  for (const [bi, block] of doc.blocks.entries()) {
    for (const [si, sentence] of block.sentences.entries()) {
      rows.push({ ref: `b${bi + 1}s${si + 1}`, blockTitle: block.title, ...sentence });
    }
  }
  return rows;
}

export function loadProbeCases(path = DIRECT) {
  const rows = new Map(flattenBrief(JSON.parse(readFileSync(path, 'utf8'))).map(x => [x.ref, x]));
  return CASES.map(meta => {
    const row = rows.get(meta.ref);
    if (!row) throw new Error(`missing frozen sentence ${meta.ref}`);
    return { ...meta, text: row.text, sources: row.sources };
  });
}

export function atomSchemaFor(cases) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: cases.length,
        maxItems: cases.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['parentRef', 'atoms'],
          properties: {
            parentRef: { type: 'string', enum: cases.map(x => x.ref) },
            atoms: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text'],
                properties: {
                  text: { type: 'string', minLength: 1, maxLength: 500 },
                },
              },
            },
          },
        },
      },
    },
  };
}

export function atomicizerPrompt(cases) {
  const atomSchema = atomSchemaFor(cases);
  const material = cases.map(c => `### ${c.ref}\nTEXT: ${c.text}`).join('\n\n');
  return `Split each candidate sentence into independently checkable atomic factual assertions.

This is syntactic decomposition, not verification. You cannot see source text. Preserve every
factual element from the input, including attribution, causality, modality, time, place, numbers,
and descriptive qualifiers. Do not correct, weaken, delete, or add information. Separate independent
predicates and detachable qualifiers when they can be judged independently. Produce a minimal,
non-overlapping partition: represent every factual element exactly once. Never output the same fact
both alone and again inside a larger atom, and never create paraphrase duplicates. Before returning,
compare the atoms clause by clause with TEXT and restore any omitted attribution, comparison,
superlative, cause, time, place, number, or qualifier. Each atom must be a self-contained English
sentence. Do not emit citations or source indexes; code inherits the complete parent evidence bundle
after decomposition.

Return every parent exactly once and in input order. Do not merge facts across parents.

${material}\n\nReturn only JSON matching this schema:\n${JSON.stringify(atomSchema)}`;
}

export function atomsOk(obj, cases) {
  if (!Array.isArray(obj?.items) || obj.items.length !== cases.length) return false;
  if (obj.items.some((x, i) => x.parentRef !== cases[i].ref || !Array.isArray(x.atoms) || !x.atoms.length))
    return false;
  return obj.items.every(x => x.atoms.every(a => typeof a?.text === 'string' && a.text.trim()));
}

export function assignAtomIds(atomized) {
  return {
    items: atomized.items.map(item => ({
      ...item,
      atoms: item.atoms.map((atom, i) => ({ ...atom, atomId: `${item.parentRef}a${i + 1}` })),
    })),
  };
}

export function normalizeAtoms(atomized, cases) {
  return {
    items: atomized.items.map((item, parentIndex) => {
      const seen = new Set();
      const sourceIndexes = cases[parentIndex].sources.map((_, i) => i + 1);
      const atoms = item.atoms
        .filter(atom => {
          const key = atom.text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(atom => ({ text: atom.text.trim().replace(/\s+/g, ' '), sourceIndexes }));
      return { parentRef: item.parentRef, atoms };
    }),
  };
}

const COVERAGE_STOPWORDS = new Set([
  'about',
  'after',
  'against',
  'been',
  'being',
  'from',
  'have',
  'into',
  'more',
  'only',
  'over',
  'that',
  'their',
  'them',
  'than',
  'they',
  'this',
  'under',
  'while',
  'with',
]);

function contentTokens(text) {
  return new Set(
    text
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+(?:[.'’-][\p{L}\p{N}]+)*/gu)
      ?.filter(token => /\d/.test(token) || (token.length >= 4 && !COVERAGE_STOPWORDS.has(token))) ?? []
  );
}

export function atomCoverage(parentText, atoms) {
  const expected = contentTokens(parentText);
  const actual = contentTokens(atoms.map(atom => atom.text).join(' '));
  const missing = [...expected].filter(token => !actual.has(token));
  return {
    expected: expected.size,
    covered: expected.size - missing.length,
    ratio: expected.size ? (expected.size - missing.length) / expected.size : 1,
    missing,
  };
}

const CHECK_KEYS = ['identity', 'action', 'object', 'number', 'time', 'place', 'causality', 'modality', 'attribution'];
const CHECK_VALUES = ['supported', 'unsupported', 'uncertain', 'not_applicable'];
const checkProperties = Object.fromEntries(CHECK_KEYS.map(k => [k, { type: 'string', enum: CHECK_VALUES }]));

export const gateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      minItems: 1,
      maxItems: 64,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['atomId', 'checks', 'unsupportedSpans', 'uncertainSpans', 'supportingSourceIndexes', 'reason'],
        properties: {
          atomId: { type: 'string' },
          checks: {
            type: 'object',
            additionalProperties: false,
            required: CHECK_KEYS,
            properties: checkProperties,
          },
          unsupportedSpans: {
            type: 'array',
            maxItems: 12,
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          uncertainSpans: {
            type: 'array',
            maxItems: 12,
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          supportingSourceIndexes: {
            type: 'array',
            maxItems: 4,
            items: { type: 'integer', minimum: 1, maximum: 4 },
          },
          reason: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
  },
};

function evidenceText(cluster, parent, atom) {
  return atom.sourceIndexes
    .map(index => {
      const source = parent.sources[index - 1];
      return `${index}=[${source.articleId}:${source.sentence}] ${sentenceOf(cluster, source.articleId, source.sentence)}`;
    })
    .join('\n');
}

export function gatePrompt(cases, atomized, cluster) {
  const parents = new Map(cases.map(x => [x.ref, x]));
  const material = atomized.items
    .flatMap(item =>
      item.atoms.map(atom => {
        const parent = parents.get(item.parentRef);
        return `### ${atom.atomId}\nCLAIM: ${atom.text}\nEVIDENCE:\n${evidenceText(cluster, parent, atom)}`;
      })
    )
    .join('\n\n');
  return `Audit every factual dimension of each atomic claim against its verbatim evidence.

Fill all nine checks. Use not_applicable only when that dimension is absent from CLAIM, never when it
is present but absent from EVIDENCE. identity covers actors and every proper name; action covers the
predicate strength; attribution covers who said/reported/claimed the information. A generic entity
never supports a specific unnamed identity: evidence saying "a tanker" does not support a claim
naming that tanker. Attribution is exact: "a military branch said" does not support "state media
reported". Every named actor and object must appear explicitly in EVIDENCE or be resolved by an
unambiguous coreference inside the supplied evidence bundle. Do not equate an armed force or
government agency with state media.

Respect epistemic scope. For a claim of the form "X said/reported/claimed P", judge whether the
evidence says X made that assertion; P need not be independently true. A later denial of P does not
invalidate the fact that X asserted it. Conversely, evidence that P happened does not prove that X
reported it. Respect relation scope too: two events occurring on the same day does not establish
that one happened before or after the other, and shared context does not establish causality. Treat
"as" or "during" as factual context unless the evidence itself uses uncertainty or hypothetical
language. Mere topical relevance is not support.

First decide whether a dimension is explicitly present in CLAIM. If CLAIM contains no date or time,
for example, time must be not_applicable even when EVIDENCE contains a date. Never penalize CLAIM
for omitting a detail that appears only in EVIDENCE.

For every unsupported check, copy at least one responsible unsupportedSpans value verbatim from
CLAIM. Do the same for uncertain checks and uncertainSpans. Each span must be an exact substring of
CLAIM; never copy a span that appears only in EVIDENCE. Include only spans needed to explain the
claim's unsupported or uncertain content.
If all applicable checks are supported, both span arrays are empty and supportingSourceIndexes lists
the evidence indexes that support the full claim. For rejected claims this array may be empty or list
evidence that supports only the remaining parts; deterministic code discards it. Do not use outside
knowledge, do not rewrite claims, and return every atom exactly once.

${material}\n\nReturn only JSON matching this schema:\n${JSON.stringify(gateSchema)}`;
}

function spansAreExact(text, spans) {
  const lower = text.toLocaleLowerCase();
  return (
    Array.isArray(spans) && spans.every(s => typeof s === 'string' && s.trim() && lower.includes(s.toLocaleLowerCase()))
  );
}

export function sanitizeGateOutput(obj, atomized) {
  if (!Array.isArray(obj?.results)) return obj;
  const byId = new Map(atomized.items.flatMap(item => item.atoms.map(atom => [atom.atomId, atom])));
  return {
    ...obj,
    results: obj.results.map(result => {
      const atom = byId.get(result?.atomId);
      if (!atom) return result;
      const exactOnly = spans =>
        Array.isArray(spans)
          ? spans.filter(span => typeof span === 'string' && spansAreExact(atom.text, [span]))
          : spans;
      return {
        ...result,
        unsupportedSpans: exactOnly(result.unsupportedSpans),
        uncertainSpans: exactOnly(result.uncertainSpans),
      };
    }),
  };
}

export function verdictOf(result) {
  const values = Object.values(result.checks);
  // Either representation can veto admission. The fixed checklist catches dimensions such as
  // attribution; exact spans catch a missed checklist classification such as an unsupported origin.
  if (values.includes('unsupported') || result.unsupportedSpans.length) return 'unsupported';
  if (values.includes('uncertain') || result.uncertainSpans.length) return 'uncertain';
  return 'supported';
}

export function gateOk(obj, atomized, cases) {
  const atoms = atomized.items.flatMap(x => x.atoms);
  const byId = new Map(atoms.map(a => [a.atomId, a]));
  const parentByAtom = new Map(atomized.items.flatMap((x, i) => x.atoms.map(a => [a.atomId, cases[i]])));
  if (!Array.isArray(obj?.results) || obj.results.length !== atoms.length) return false;
  const seen = new Set();
  for (const r of obj.results) {
    if (!byId.has(r?.atomId) || seen.has(r.atomId)) return false;
    if (typeof r.reason !== 'string' || !r.reason.trim() || !Array.isArray(r.supportingSourceIndexes)) return false;
    const atom = byId.get(r.atomId);
    if (
      !r.checks ||
      Object.keys(r.checks).length !== CHECK_KEYS.length ||
      CHECK_KEYS.some(k => !CHECK_VALUES.includes(r.checks[k]))
    )
      return false;
    if (!spansAreExact(atom.text, r.unsupportedSpans) || !spansAreExact(atom.text, r.uncertainSpans)) return false;
    if (Object.values(r.checks).includes('unsupported') && r.unsupportedSpans.length === 0) return false;
    if (Object.values(r.checks).includes('uncertain') && r.uncertainSpans.length === 0) return false;
    if (verdictOf(r) === 'supported' && r.supportingSourceIndexes.length === 0) return false;
    const parent = parentByAtom.get(r.atomId);
    if (r.supportingSourceIndexes.some(n => !Number.isInteger(n) || n < 1 || n > parent.sources.length)) return false;
    if (r.supportingSourceIndexes.some(n => !atom.sourceIndexes.includes(n))) return false;
    seen.add(r.atomId);
  }
  return true;
}

export async function chatJson(tag, prompt, schema, ok, callsPath) {
  for (const [attempt, temperature] of [0, 0.1].entries()) {
    const t0 = Date.now();
    let http = 0,
      finish = '',
      text = '',
      err = '',
      usage = {};
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          options: {
            provider: 'workers-ai',
            model: MODEL,
            temperature,
            max_tokens: 8000,
            skipCache: true,
            response_format: { type: 'json_schema', json_schema: schema },
          },
        }),
        signal: AbortSignal.timeout(600_000),
      });
      http = res.status;
      const json = await res.json();
      finish = json?.data?.choices?.[0]?.finish_reason ?? '';
      text = String(json?.data?.choices?.[0]?.message?.content ?? '');
      usage = json?.data?.usage ?? {};
      if (!json?.success) err = JSON.stringify(json?.error ?? json).slice(0, 500);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* retry */
    }
    const good = http === 200 && finish !== 'length' && parsed && ok(parsed);
    const record = {
      tag,
      attempt: attempt + 1,
      temperature,
      wall_s: +((Date.now() - t0) / 1000).toFixed(2),
      http,
      finish,
      in_tok: usage.prompt_tokens ?? null,
      out_tok: usage.completion_tokens ?? null,
      ok: !!good,
      err,
      ...(good ? {} : { invalid_output: text.slice(0, 12_000) }),
    };
    appendFileSync(callsPath, `${JSON.stringify(record)}\n`);
    console.log(
      `[${tag}#${attempt + 1}] ${record.wall_s}s http=${http} in=${record.in_tok ?? '-'} out=${record.out_tok ?? '-'} ok=${record.ok}`
    );
    if (good) return parsed;
  }
  throw new Error(`${tag}: all model attempts failed validation`);
}

export function scoreProbe(cases, atomized, gated, cluster) {
  const gates = new Map(gated.results.map(x => [x.atomId, x]));
  const caseByRef = new Map(cases.map(x => [x.ref, x]));
  const results = atomized.items.map(item => {
    const meta = caseByRef.get(item.parentRef);
    const atoms = item.atoms.map(atom => {
      const gate = gates.get(atom.atomId);
      const modelVerdict = verdictOf(gate);
      const danglingReference = /\b(?:that account|this account|the former|the latter|this move|that move)\b/i.test(
        atom.text
      );
      const verdict = danglingReference && modelVerdict === 'supported' ? 'uncertain' : modelVerdict;
      const sources = verdict === 'supported' ? gate.supportingSourceIndexes.map(i => meta.sources[i - 1]) : [];
      const evidenceNumbers = new Set(
        sources.flatMap(s => [...numbersIn(sentenceOf(cluster, s.articleId, s.sentence))])
      );
      const missingNumbers = [...numbersIn(atom.text)].filter(n => !evidenceNumbers.has(n));
      return { ...atom, ...gate, verdict, danglingReference, sources, missingNumbers };
    });
    const admitted = atoms.filter(x => x.verdict === 'supported');
    const rejected = atoms.filter(x => !admitted.includes(x));
    const pass = meta.expected === 'mixed' ? rejected.length > 0 : admitted.length > 0 && rejected.length === 0;
    return {
      ref: item.parentRef,
      expected: meta.expected,
      pass,
      admitted: admitted.length,
      rejected: rejected.length,
      atoms,
    };
  });
  return {
    pass: results.every(x => x.pass) && results.filter(x => x.expected === 'mixed' && x.admitted > 0).length >= 2,
    criteria: {
      mixedAllRejectSomething: results.filter(x => x.expected === 'mixed').every(x => x.rejected > 0),
      mixedParentsSalvaged: results.filter(x => x.expected === 'mixed' && x.admitted > 0).length,
      controlsAllAccepted: results
        .filter(x => x.expected === 'supported')
        .every(x => x.admitted > 0 && x.rejected === 0),
      citationsResolvable: results.every(x =>
        x.atoms.every(a => a.sources.every(s => sentenceOf(cluster, s.articleId, s.sentence) !== undefined))
      ),
      admittedNumbersExactMatch: results.every(x =>
        x.atoms.filter(a => a.verdict === 'supported').every(a => a.missingNumbers.length === 0)
      ),
    },
    results,
  };
}

export function makeGateUnits(cases, atomized) {
  const units = [];
  for (const [i, item] of atomized.items.entries()) {
    const groups = new Map();
    for (const atom of item.atoms) {
      const key = [...atom.sourceIndexes].sort((a, b) => a - b).join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(atom);
    }
    for (const [evidenceKey, atoms] of groups) {
      units.push({
        parentRef: item.parentRef,
        evidenceKey,
        cases: [cases[i]],
        atomized: { items: [{ parentRef: item.parentRef, atoms }] },
      });
    }
  }
  return units;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  mkdirSync(OUT, { recursive: true });
  const atomPath = `${OUT}/c36-probe-atoms.json`;
  const gatePath = `${OUT}/c36-probe-gates-v6.json`;
  const gateDir = `${OUT}/c36-probe-gates-v6`;
  const callsPath = `${OUT}/calls.jsonl`;
  const cases = loadProbeCases();
  const cluster = loadCluster(36);
  let atomized;
  if (args.replay || args['reuse-atoms']) {
    if (!existsSync(atomPath)) throw new Error('replay/reuse-atoms requires cached atom output');
    atomized = JSON.parse(readFileSync(atomPath, 'utf8'));
    if (!atomsOk(atomized, cases)) throw new Error('cached atom output is invalid');
  } else {
    const atomSchema = atomSchemaFor(cases);
    const raw = await chatJson(
      'c36-probe-atomicize',
      atomicizerPrompt(cases),
      atomSchema,
      x => atomsOk(x, cases),
      callsPath
    );
    atomized = assignAtomIds(normalizeAtoms(raw, cases));
    atomicWriteJson(atomPath, atomized);
  }
  let gated;
  if (args.replay) {
    if (!existsSync(gatePath)) throw new Error('replay requires cached gate output');
    gated = JSON.parse(readFileSync(gatePath, 'utf8'));
    if (!gateOk(gated, atomized, cases)) throw new Error('cached gate output is invalid');
  } else {
    mkdirSync(gateDir, { recursive: true });
    const parts = [];
    const units = makeGateUnits(cases, atomized);
    for (const unit of units) {
      const partPath = `${gateDir}/u${parts.length + 1}.json`;
      let part;
      if (args.resume && existsSync(partPath)) {
        part = JSON.parse(readFileSync(partPath, 'utf8'));
        if (!gateOk(part, unit.atomized, unit.cases))
          throw new Error(`cached gate unit ${parts.length + 1} is invalid`);
        console.log(`[c36-probe-gate-u${parts.length + 1}] reused ${unit.parentRef} evidence=${unit.evidenceKey}`);
      } else {
        const raw = await chatJson(
          `c36-probe-gate-u${parts.length + 1}`,
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
    if (!gateOk(gated, atomized, cases)) throw new Error('combined gate output is invalid');
    atomicWriteJson(gatePath, gated);
  }
  const score = scoreProbe(cases, atomized, gated, cluster);
  atomicWriteJson(`${OUT}/c36-probe-score-v6.json`, score);
  for (const row of score.results) {
    console.log(
      `${row.pass ? 'PASS' : 'FAIL'} ${row.ref} expected=${row.expected} admitted=${row.admitted} rejected=${row.rejected}`
    );
  }
  console.log(`probe ${score.pass ? 'PASS' : 'FAIL'}`);
  process.exitCode = score.pass ? 0 : 1;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  main().catch(e => {
    console.error(e);
    process.exitCode = 2;
  });
}
