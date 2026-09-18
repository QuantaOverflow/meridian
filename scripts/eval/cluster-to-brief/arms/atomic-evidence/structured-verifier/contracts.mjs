import { hash, VERSION } from './context-store.mjs';
import { canonicalDecimal } from './numeric.mjs';
const string = { type: 'string' };
const arr = items => ({ type: 'array', items });
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const enumeration = values => ({ type: 'string', enum: values });
export const quoteSchema = obj({ sourceId: string, exactText: { type: 'string', minLength: 1 }, occurrence: { type: 'integer', minimum: 0 } });
const anchors = arr(quoteSchema);
const nodeSchema = obj({ id: string, kind: enumeration(['entity', 'event', 'population']), label: string, anchors, ambiguous: { type: 'boolean' } });
const speech = obj({ id: string, speaker: string, recipient: string, proposition: string, reportMode: enumeration(['say', 'warn', 'confirm', 'deny', 'claim', 'other', 'unknown']), polarity: enumeration(['positive', 'negative', 'unknown']), eventState: enumeration(['future', 'completed', 'ongoing', 'conditional', 'unspecified', 'unknown']), anchors, ambiguous: { type: 'boolean' } });
const quantity = obj({ id: string, population: string, value: string, unit: enumeration(['areas', 'architectural_elements', 'pages', 'other', 'unknown']), state: enumeration(['damaged', 'completely_destroyed', 'mixed_damage', 'other', 'unknown']), extent: enumeration(['total', 'subset', 'unspecified', 'unknown']), reportSource: string, anchors, ambiguous: { type: 'boolean' } });
const residual = enumeration(['none', 'nonfactual', 'time_direction', 'identity_role', 'action_scope', 'other_family', 'ambiguous', 'needs_context']);
export function extractionSchema(family) {
  return obj({ version: enumeration([VERSION]), family: enumeration([family]), sourceHash: string, nodes: arr(nodeSchema), facts: arr(family === 'speech' ? speech : quantity),
    coverage: arr(obj({ span: quoteSchema, factIds: arr(string), residualCode: residual })), needsContext: arr(obj({ sourceId: string, reasonCode: enumeration(['coreference', 'report_scope', 'population_scope', 'other']) })) });
}
export const alignmentSchema = obj({ nodeLinks: arr(obj({ candidateNodeId: string, evidenceNodeId: string, relation: enumeration(['equivalent', 'different', 'ambiguous']), anchors })),
  factPairs: arr(obj({ candidateFactId: string, evidenceFactId: string, unresolved: { type: 'boolean' }, anchors })) });
export function validateShape(x, schema, path = '$') {
  if (schema.type === 'object') {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error(`${path}: object expected`);
    if (Object.keys(x).some(k => !Object.hasOwn(schema.properties, k)) || schema.required.some(k => !Object.hasOwn(x, k))) throw Error(`${path}: fields mismatch`);
    for (const [k, s] of Object.entries(schema.properties)) validateShape(x[k], s, `${path}.${k}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(x) || x.length > 80) throw Error(`${path}: array expected/cap`);
    x.forEach((v, i) => validateShape(v, schema.items, `${path}[${i}]`));
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(x) || x < (schema.minimum ?? -Infinity)) throw Error(`${path}: integer expected`);
  } else if (typeof x !== schema.type || (schema.minLength && x.length < schema.minLength) || (schema.enum && !schema.enum.includes(x))) throw Error(`${path}: invalid scalar`);
  return true;
}
export function resolveQuote(q, documents) {
  const document = documents.find(d => d.sourceId === q.sourceId);
  if (!document || !q.exactText) throw Error('unknown source/empty quote');
  const locations = [];
  for (let from = 0; from <= document.text.length;) {
    const i = document.text.indexOf(q.exactText, from);
    if (i < 0) break;
    locations.push(i); from = i + 1;
  }
  if (!locations.length || (q.occurrence === 0 && locations.length !== 1) || q.occurrence > locations.length) throw Error('quote absent/ambiguous occurrence');
  const start = locations[q.occurrence === 0 ? 0 : q.occurrence - 1];
  return { ...q, start, end: start + q.exactText.length, sourceHash: hash(document.text) };
}
function resolveAnchors(anchors, documents) {
  if (!anchors.length) throw Error('missing anchors');
  return anchors.map(a => resolveQuote(a, documents));
}
export function validateExtraction(raw, family, documents) {
  validateShape(raw, extractionSchema(family));
  if (raw.sourceHash !== hash(documents)) throw Error('sourceHash mismatch');
  const ids = new Set();
  const nodes = raw.nodes.map(n => {
    if (!n.id || !n.label.trim() || ids.has(n.id)) throw Error('duplicate/empty node id or label');
    if (n.label.trim().toLowerCase() === 'unknown' && !n.ambiguous) throw Error('unknown node must be ambiguous');
    ids.add(n.id); return { ...n, anchors: resolveAnchors(n.anchors, documents) };
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  const factIds = new Set();
  const facts = raw.facts.map(f => {
    if (!f.id || ids.has(f.id) || factIds.has(f.id)) throw Error('duplicate fact id');
    factIds.add(f.id);
    const typed = family === 'speech' ? [['speaker', 'entity'], ['recipient', 'entity'], ['proposition', 'event']] : [['population', 'population'], ['reportSource', 'entity']];
    for (const [key, kind] of typed) {
      if (['recipient', 'reportSource'].includes(key) && f[key] === '') continue;
      if (byId.get(f[key])?.kind !== kind) throw Error(`invalid ${key} node`);
    }
    const normalizedValue = family === 'scoped_quantity' ? { value: canonicalDecimal(f.value), rawValue: f.value } : {};
    return { ...f, ...normalizedValue, anchors: resolveAnchors(f.anchors, documents) };
  });
  const coverage = raw.coverage.map(c => {
    if (c.factIds.some(id => !factIds.has(id)) || (c.residualCode === 'none' && !c.factIds.length)) throw Error('coverage reference missing');
    return { ...c, span: resolveQuote(c.span, documents) };
  });
  // Every character is accounted for structurally. This is NOT semantic coverage certification.
  for (const d of documents) {
    const ranges = coverage.filter(c => c.span.sourceId === d.sourceId).sort((a, b) => a.span.start - b.span.start);
    let cursor = 0;
    for (const c of ranges) { if (c.span.start !== cursor) throw Error('coverage gap/overlap'); cursor = c.span.end; }
    if (cursor !== d.text.length) throw Error('coverage incomplete');
  }
  for (const request of raw.needsContext) if (!documents.some(d => d.sourceId === request.sourceId)) throw Error('unregistered context request');
  return { ...raw, nodes, facts, coverage, semanticCoverageVerified: false };
}
export function validateAlignment(raw, candidate, evidence, documents) {
  validateShape(raw, alignmentSchema);
  const cn = new Map(candidate.nodes.map(n => [n.id, n])), en = new Map(evidence.nodes.map(n => [n.id, n]));
  const cf = new Set(candidate.facts.map(f => f.id)), ef = new Set(evidence.facts.map(f => f.id));
  const seen = new Set();
  for (const link of raw.nodeLinks) {
    if (!cn.has(link.candidateNodeId) || !en.has(link.evidenceNodeId) || cn.get(link.candidateNodeId).kind !== en.get(link.evidenceNodeId).kind) throw Error('invalid node alignment');
    const key = `${link.candidateNodeId}:${link.evidenceNodeId}`;
    if (seen.has(key)) throw Error('duplicate node link'); seen.add(key);
  }
  for (const pair of raw.factPairs) if (!cf.has(pair.candidateFactId) || !ef.has(pair.evidenceFactId)) throw Error('invalid fact alignment');
  if (raw.factPairs.some((p, i) => raw.factPairs.some((q, j) => j < i && p.candidateFactId === q.candidateFactId && p.evidenceFactId === q.evidenceFactId))) throw Error('duplicate fact pair');
  return { ...raw, nodeLinks: raw.nodeLinks.map(l => ({ ...l, anchors: resolveAnchors(l.anchors, documents) })), factPairs: raw.factPairs.map(l => ({ ...l, anchors: resolveAnchors(l.anchors, documents) })) };
}
