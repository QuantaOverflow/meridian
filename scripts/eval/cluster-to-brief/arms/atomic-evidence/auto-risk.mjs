import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { loadCluster, sentenceOf } from '../../lib.mjs';
import { atomicWriteJson, chatJson } from './probe.mjs';
import { schemaFor, validOutput, cleanQuoteEllipses } from './risk-spike.mjs';

const OUT = new URL('../../out/atomic-evidence/', import.meta.url).pathname;
export const CASES = [
  {
    id: 't1',
    text: 'Iranian state media reported that the tanker El Gaia struck a sea mine and exploded in the Strait of Hormuz.',
    sources: [[1002754, 1]],
  },
  {
    id: 't2',
    text: 'Iran claimed that an oil tanker collided with a naval mine in the Strait of Hormuz.',
    sources: [[1002874, 1]],
  },
  {
    id: 't3',
    text: 'The attack on the Iranian ship occurred after the pipeline was damaged.',
    sources: [[996847, 19]],
  },
  {
    id: 't4',
    text: 'Oil prices jumped after an Iranian ship was attacked in the Strait of Hormuz.',
    sources: [[996847, 19]],
  },
];
const planSchema = {
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
        required: ['id', 'questions'],
        properties: {
          id: { type: 'string' },
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['claimSpan', 'question'],
              properties: {
                claimSpan: { type: 'string', minLength: 1 },
                question: { type: 'string', minLength: 1, maxLength: 300 },
              },
            },
          },
        },
      },
    },
  },
};
export function planOk(value) {
  return (
    Array.isArray(value?.results) &&
    value.results.length === CASES.length &&
    value.results.every(
      (r, i) =>
        r.id === CASES[i].id &&
        Array.isArray(r.questions) &&
        r.questions.length >= 1 &&
        r.questions.length <= 3 &&
        r.questions.every(
          q =>
            typeof q.claimSpan === 'string' &&
            q.claimSpan.length > 0 &&
            CASES[i].text.includes(q.claimSpan) &&
            typeof q.question === 'string' &&
            q.question.trim()
        )
    )
  );
}
export function tasksOf(plan) {
  return plan.results.flatMap((r, i) =>
    r.questions.map((q, j) => ({ ...CASES[i], id: `${r.id}q${j + 1}`, question: q.question, plannedSpan: q.claimSpan }))
  );
}
async function main() {
  mkdirSync(OUT, { recursive: true });
  const path = `${OUT}/auto-risk-plan.json`,
    log = `${OUT}/auto-risk-calls.jsonl`;
  let plan;
  if (process.argv.includes('--resume') && existsSync(path)) {
    plan = JSON.parse(readFileSync(path, 'utf8'));
    if (!planOk(plan)) throw new Error('invalid plan cache');
  } else {
    plan = await chatJson(
      'auto-risk-plan',
      `Create at most three narrow evidence-audit questions per candidate. You cannot see evidence and must not decide truth, rewrite or correct the candidate. Cover the materially distinct factual risks in CLAIM, not absent dimensions. Names and reporting speaker identities must be checked separately when distinct. For attributed statements check who asserted what, not whether the quoted proposition is true. For before/after check precisely the asserted pair and direction. Preserve all named objects and action strength in questions. Do not invent assumptions or hint at the expected answer. Return exact claimSpan anchors and one independently answerable question per anchor.\n${CASES.map(c => `ID ${c.id}\nCLAIM ${c.text}`).join('\n\n')}\nReturn JSON ${JSON.stringify(planSchema)}`,
      planSchema,
      planOk,
      log
    );
    atomicWriteJson(path, plan);
  }
  console.log(JSON.stringify(plan, null, 2));
  if (process.argv.includes('--plan-only')) return;
  const cluster = loadCluster(36),
    tasks = tasksOf(plan);
  for (let start = 0; start < tasks.length; start += 4) {
    const batch = tasks.slice(start, start + 4),
      evidence = batch.map(c => c.sources.map(([a, s]) => sentenceOf(cluster, a, s)));
    const resultPath = `${OUT}/auto-risk-gate-b${start / 4 + 1}.json`;
    if (process.argv.includes('--resume') && existsSync(resultPath)) {
      if (!validOutput(JSON.parse(readFileSync(resultPath, 'utf8')), batch, evidence))
        throw new Error('invalid gate cache');
      continue;
    }
    const schema = schemaFor(batch.length);
    const prompt = `Answer ONLY each RISK QUESTION against the supplied evidence. One check per task; include an exact claimSpan, exact evidence quotes with sourceIndex, and supported/unsupported/uncertain status. X asserted P can be supported even when P is denied; the reporting actor must match. Generic entities do not establish specific names. Shared dates do not establish order. Unsupported and uncertain checks veto admission. Do not repair claims. Never put ellipses in quotes.\n${batch.map((c, i) => `ID ${c.id}\nCLAIM ${c.text}\nRISK QUESTION ${c.question}\nEVIDENCE\n${evidence[i].map((s, j) => `${j + 1}: ${s}`).join('\n')}`).join('\n\n')}\nReturn JSON ${JSON.stringify(schema)}`;
    const raw = await chatJson(
      `auto-risk-gate-b${start / 4 + 1}`,
      prompt,
      schema,
      x => validOutput(cleanQuoteEllipses(x, evidence), batch, evidence),
      log
    );
    const result = cleanQuoteEllipses(raw, evidence);
    atomicWriteJson(resultPath, { ...result, raw });
    console.log(JSON.stringify(result, null, 2));
  }
}
if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname)
  main().catch(e => {
    console.error(e);
    process.exitCode = 1;
  });
