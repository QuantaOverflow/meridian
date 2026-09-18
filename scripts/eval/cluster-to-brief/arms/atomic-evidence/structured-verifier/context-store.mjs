import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { splitSentences } from '../../../lib.mjs';

export const VERSION = 'structured-v0.2';
export const hash = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const ROOT = new URL('../../../', import.meta.url);
export class ContextStore {
  constructor(row, { radius = 2, maxChars = 18000 } = {}) {
    this.row = row;
    this.radius = radius;
    this.maxChars = maxChars;
    this.registered = new Map();
    const meta = JSON.parse(readFileSync(new URL('fixtures/meta.json', ROOT), 'utf8'));
    for (const source of row.sources) {
      if (!Number.isInteger(source.articleId) || !Number.isInteger(source.sentence)) throw Error('invalid source coordinate');
      if (!this.registered.has(source.articleId)) {
        const content = readFileSync(new URL(`fixtures/content/${source.articleId}.txt`, ROOT), 'utf8');
        this.registered.set(source.articleId, { sentences: splitSentences(content), title: meta[source.articleId]?.title ?? '', publishDate: meta[source.articleId]?.publishDate ?? '' });
      }
      const exact = this.registered.get(source.articleId).sentences[source.sentence - 1];
      const frozen = row.evidence.find(e => e.articleId === source.articleId && e.sentence === source.sentence);
      if (!exact || !frozen || exact !== frozen.text || hash(exact) !== frozen.sha256) throw Error('frozen coordinate/hash drift');
    }
  }
  getSourceWindow(articleId, start, end) {
    const article = this.registered.get(articleId);
    if (!article || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > article.sentences.length) throw Error('invalid registered window');
    const rows = article.sentences.slice(start - 1, end).map((text, i) => ({ sourceId: `source-${articleId}-${start + i}`, text, sha256: hash(text), coordinate: { articleId, sentence: start + i } }));
    if (rows.reduce((n, x) => n + x.text.length, 0) > this.maxChars) throw Error('context_overflow');
    return rows;
  }
  packet() {
    const documents = new Map();
    for (const s of this.row.sources) {
      const a = this.registered.get(s.articleId);
      for (const d of this.getSourceWindow(s.articleId, Math.max(1, s.sentence - this.radius), Math.min(a.sentences.length, s.sentence + this.radius))) documents.set(d.sourceId, d);
    }
    const evidence = [...documents.values()].sort((a, b) => a.coordinate.articleId - b.coordinate.articleId || a.coordinate.sentence - b.coordinate.sentence);
    if (evidence.reduce((n, d) => n + d.text.length, 0) > this.maxChars) throw Error('context_overflow');
    return { version: VERSION, protocol: 'context-v2-radius2', candidate: { sourceId: 'candidate', text: this.row.text, sha256: hash(this.row.text) }, evidence,
      articles: [...this.registered].map(([articleId, a]) => ({ articleId, title: a.title, publishDate: a.publishDate })),
      evidenceHash: hash(evidence), contextSufficient: 'requires_independent_local_review', truncated: false };
  }
}
export function inputRows() {
  return readFileSync(new URL('gold/practice-risk-v1/inputs.jsonl', ROOT), 'utf8').trim().split('\n').map(JSON.parse);
}
export function freezePlan() {
  const families = { p11: 'speech', p12: 'speech', p20: 'scoped_quantity' };
  const inventory = { p08: ['identity_role'], p11: ['time_direction'], p12: [], p14: ['time_direction', 'other_family'], p20: ['action_scope'], p21: ['time_direction', 'action_scope'], p29: ['action_scope'] };
  const selected = inputRows().filter(r => Object.hasOwn(inventory, r.id.slice(0, 3)));
  const smoke = selected.filter(r => families[r.id.slice(0, 3)]).sort((a, b) => hash(a.text).localeCompare(hash(b.text))).map((row, i) => ({ opaqueId: `item-${i + 1}`, originalId: row.id, family: families[row.id.slice(0, 3)], registeredResidual: inventory[row.id.slice(0, 3)], packet: new ContextStore(row).packet() }));
  return { version: VERSION, inventory: selected.map(r => ({ originalId: r.id, residual: inventory[r.id.slice(0, 3)], smoke: !!families[r.id.slice(0, 3)], candidateHash: hash(r.text), context: new ContextStore(r).packet() })), smoke,
    limits: { logicalCalls: 21, httpAttempts: 42, knownTokens: 30000, timeoutMs: 120000 },
    evaluation: 'nonblind_known_failure_component_diagnostic; references excluded from requests' };
}
