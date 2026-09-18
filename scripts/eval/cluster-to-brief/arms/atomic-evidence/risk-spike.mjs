import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { loadCluster, sentenceOf } from '../../lib.mjs';
import { atomicWriteJson, chatJson } from './probe.mjs';

const OUT = new URL('../../out/atomic-evidence/', import.meta.url).pathname;
export const CASES = [
  {
    id: 'blockade',
    text: 'The Strait of Hormuz remains under US and Iranian blockades.',
    sources: [[996561, 2]],
    question: 'Is this asserted as factual context or explicitly hypothetical?',
  },
  {
    id: 'disputed-report',
    text: 'Iran claimed that an oil tanker collided with a naval mine in the Strait of Hormuz.',
    sources: [[1002874, 1]],
    question: 'Did Iran make this claim, regardless of whether the claim is true?',
  },
  {
    id: 'wrong-speaker',
    text: 'Iranian state media reported that an oil tanker struck a sea mine and exploded in the Strait of Hormuz.',
    sources: [[1002754, 1]],
    question: 'Does the evidence identify state media as the reporting speaker, rather than the IRGC?',
  },
  {
    id: 'missing-name',
    text: 'The IRGC said that the tanker El Gaia struck a sea mine and exploded in the Strait of Hormuz.',
    sources: [[1002754, 1]],
    question: 'Does the evidence explicitly identify the tanker as El Gaia?',
  },
  {
    id: 'stronger-action',
    text: 'Saudi Arabia’s East-West oil pipeline was temporarily shut by a drone attack.',
    sources: [[996847, 19]],
    question: 'Does damage explicitly entail a temporary shutdown here?',
  },
  {
    id: 'matched-action',
    text: 'Saudi Arabia’s East-West oil pipeline was damaged in a drone attack.',
    sources: [[996847, 19]],
    question: 'Is pipeline damage in a drone attack explicitly reported?',
  },
  {
    id: 'invented-order',
    text: 'The attack on the Iranian ship occurred after the pipeline was shut.',
    sources: [[996847, 19]],
    question: 'Does the evidence establish ship attack AFTER pipeline shutdown, not merely mention both?',
  },
  {
    id: 'matched-order',
    text: 'Oil prices jumped after an Iranian ship was attacked in the Strait of Hormuz.',
    sources: [[996847, 19]],
    question: 'Does the evidence establish the price jump AFTER the ship attack?',
  },
];

const checkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'claimSpan', 'status', 'quotes', 'reason'],
  properties: {
    dimension: { type: 'string' },
    claimSpan: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['supported', 'unsupported', 'uncertain'] },
    quotes: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceIndex', 'text'],
        properties: { sourceIndex: { type: 'integer', minimum: 1 }, text: { type: 'string', minLength: 1 } },
      },
    },
    reason: { type: 'string', maxLength: 400 },
  },
};
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'checks'],
        properties: { id: { type: 'string' }, checks: { type: 'array', minItems: 1, maxItems: 9, items: checkSchema } },
      },
    },
  },
};

export function schemaFor(count) {
  const result = structuredClone(schema);
  result.properties.results.minItems = count;
  result.properties.results.maxItems = count;
  return result;
}

export function validOutput(value, cases, evidence) {
  if (!Array.isArray(value?.results) || value.results.length !== cases.length) return false;
  return value.results.every(
    (result, i) =>
      result.id === cases[i].id &&
      Array.isArray(result.checks) &&
      result.checks.length &&
      result.checks.every(
        check =>
          typeof check.claimSpan === 'string' &&
          cases[i].text.includes(check.claimSpan) &&
          ['supported', 'unsupported', 'uncertain'].includes(check.status) &&
          Array.isArray(check.quotes) &&
          (check.status !== 'supported' || check.quotes.length > 0) &&
          check.quotes.every(
            quote =>
              Number.isInteger(quote.sourceIndex) &&
              typeof quote.text === 'string' &&
              quote.text.length > 0 &&
              evidence[i][quote.sourceIndex - 1]?.includes(quote.text)
          )
      )
  );
}

export function cleanQuoteEllipses(value, evidence) {
  const cleaned = structuredClone(value);
  for (const [i, result] of (cleaned?.results ?? []).entries()) {
    for (const check of result.checks ?? []) {
      for (const quote of check.quotes ?? []) {
        if (typeof quote.text !== 'string') continue;
        const text = quote.text.replace(/^(?:\.\.\.|…)\s*/, '').replace(/\s*(?:\.\.\.|…)$/, '');
        if (text && evidence[i]?.[quote.sourceIndex - 1]?.includes(text)) quote.text = text;
      }
    }
  }
  return cleaned;
}

export function promptFor(route, cases, evidence) {
  const task =
    route === 'alignment'
      ? 'Decompose each claim into its factual dimensions (entity identity, action strength, attribution, epistemic scope, time/order, causality and quantity when present). Audit EVERY applicable dimension, not just the easiest one. Each check must bind an exact claim span to exact evidence quotes. Missing details cannot be invented.'
      : 'For each claim answer ONLY its RISK QUESTION. Return exactly one check per claim. Ignore unrelated dimensions. A supported answer requires explicit evidence for the requested relation or identity, not topical relevance.';
  return `${task}\nThis is a prototype evidence gate, not an independent evaluator. Do not rewrite claims.\nFor X claimed P, check that X asserted P; a denial does not erase the assertion. Speaker identity must match. Generic tanker does not imply a named tanker. Damage does not imply shutdown. Same day does not imply order.\n${cases.map((c, i) => `ID: ${c.id}\nCLAIM: ${c.text}${route === 'specialist' ? `\nRISK QUESTION: ${c.question}` : ''}\nEVIDENCE:\n${evidence[i].map((s, j) => `${j + 1}: ${s}`).join('\n')}`).join('\n\n')}\nReturn results in input order. Quotes and claimSpan must be verbatim substrings, not paraphrases. Return JSON: ${JSON.stringify(schema)}`;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const cluster = loadCluster(36);
  for (const route of ['alignment', 'specialist']) {
    for (let start = 0; start < CASES.length; start += 4) {
      const cases = CASES.slice(start, start + 4);
      const evidence = cases.map(c => c.sources.map(([a, s]) => sentenceOf(cluster, a, s)));
      const path = `${OUT}/risk-${route}-b${start / 4 + 1}.json`;
      if (process.argv.includes('--resume') && existsSync(path)) {
        if (!validOutput(JSON.parse(readFileSync(path, 'utf8')), cases, evidence)) throw new Error('invalid cache');
        console.log(`reused ${path}`);
        continue;
      }
      const tag = `risk-${route}-b${start / 4 + 1}`;
      if (process.argv.includes('--recover-ellipsis')) {
        const logs = readFileSync(`${OUT}/risk-calls.jsonl`, 'utf8')
          .trim()
          .split('\n')
          .map(line => JSON.parse(line));
        const record = logs.findLast(record => record.tag === tag && record.invalid_output);
        if (record) {
          try {
            const recovered = cleanQuoteEllipses(JSON.parse(record.invalid_output), evidence);
            if (validOutput(recovered, cases, evidence)) {
              atomicWriteJson(path, {
                ...recovered,
                normalization:
                  'Removed boundary ellipses only where remainder is an exact evidence substring; raw response retained in risk-calls.jsonl.',
              });
              console.log(`recovered formatting only: ${tag}`);
              continue;
            }
          } catch {
            /* malformed output cannot be recovered */
          }
        }
      }
      const result = await chatJson(
        tag,
        promptFor(route, cases, evidence),
        schema,
        value => validOutput(value, cases, evidence),
        `${OUT}/risk-calls.jsonl`
      );
      atomicWriteJson(path, result);
      console.log(
        `${route}: ${result.results.map(r => `${r.id}=${r.checks.every(c => c.status === 'supported') ? 'admit' : 'reject'}`).join(' ')}`
      );
    }
  }
}
if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname)
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
