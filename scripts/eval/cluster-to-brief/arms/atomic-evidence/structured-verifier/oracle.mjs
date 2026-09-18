// LOCAL TEST ONLY. Hand-authored semantic reference graphs never enter model requests.
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { freezePlan, hash, VERSION } from './context-store.mjs';
import { validateExtraction, validateAlignment } from './contracts.mjs';
import { compare } from './comparator.mjs';
import { atomicWriteJson } from '../probe.mjs';
const quote = d => ({ sourceId: d.sourceId, exactText: d.text, occurrence: 0 });
const node = (id, kind, label, d) => ({ id, kind, label, anchors: [quote(d)], ambiguous: false });
function extraction(family, docs, nodes, facts, residual = []) {
  return validateExtraction({ version: VERSION, family, sourceHash: hash(docs), nodes, facts,
    coverage: docs.map(d => ({ span: quote(d), factIds: facts.map(f => f.id), residualCode: residual.length ? residual[0] : 'none' })), needsContext: [] }, family, docs);
}
export function oracleCases() {
  const plan = freezePlan();
  return plan.smoke.map(item => {
    const cd = item.packet.candidate, ed = item.packet.evidence;
    const family = item.family;
    const relevantDocs = item.originalId.startsWith('p11') ? ed.filter(d => [3, 5].includes(d.coordinate.sentence)) : family === 'scoped_quantity' ? ed.filter(d => d.coordinate.sentence === 6) : ed.filter(d => d.coordinate.sentence === 1);
    let c, e, links = [], pairs = [];
    const addPair = (candidateFactId, evidenceFactId) => pairs.push({ candidateFactId, evidenceFactId, unresolved: false, anchors: [quote(cd), ...relevantDocs.map(quote)] });
    const addLink = (candidateNodeId, evidenceNodeId, relation) => links.push({ candidateNodeId, evidenceNodeId, relation, anchors: [quote(cd), ...relevantDocs.map(quote)] });
    if (family === 'speech') {
      const is11 = item.originalId.startsWith('p11');
      const bad = item.originalId.endsWith('-u');
      const labels = is11 ? ['announcement wording deters adversaries', 'more disclosure undermines deterrence'] : ['announcement accelerates arms race with Russia and China in orbit'];
      const cn = [node('speaker', 'entity', is11 ? bad ? 'Reporters' : 'Meink' : 'Analysts', cd), ...labels.map((label, i) => node(`p${i}`, 'event', label, cd))];
      const en = [node('speaker', 'entity', is11 ? 'Meink' : 'Analysts', relevantDocs[0]), ...labels.map((label, i) => node(`p${i}`, 'event', label, relevantDocs[i] ?? relevantDocs[0]))];
      if (is11 && !bad) cn.push(node('listener', 'entity', 'Reporters', cd));
      if (is11) en.push(node('listener', 'entity', 'Reporters', relevantDocs[1]));
      const cf = labels.map((_, i) => ({ id: `f${i}`, speaker: 'speaker', recipient: is11 && !bad && i === 1 ? 'listener' : '', proposition: `p${i}`, reportMode: is11 ? 'say' : bad ? 'confirm' : 'warn', polarity: 'positive', eventState: is11 ? i ? 'conditional' : 'completed' : bad ? 'completed' : 'future', anchors: [quote(cd)], ambiguous: false }));
      const ef = cf.map((f, i) => ({ ...f, recipient: is11 && i === 1 ? 'listener' : '', reportMode: is11 ? 'say' : 'warn', eventState: is11 ? i ? 'conditional' : 'completed' : 'future', anchors: [quote(relevantDocs[i] ?? relevantDocs[0])] }));
      c = extraction(family, [cd], cn, cf); e = extraction(family, ed, en, ef);
      for (let i = 0; i < cf.length; i++) { addPair(`f${i}`, `f${i}`); addLink(`p${i}`, `p${i}`, 'equivalent'); }
      addLink('speaker', 'speaker', is11 && bad ? 'different' : 'equivalent');
      if (is11 && !bad) addLink('listener', 'listener', 'equivalent');
    } else {
      const bad = item.originalId.endsWith('-u');
      const cn = [node('population', 'population', 'areas at the temple', cd), node('origin', 'entity', 'UNESCO report', cd)];
      const en = [node('population', 'population', 'areas at the temple', relevantDocs[0]), node('origin', 'entity', 'UNESCO report', relevantDocs[0])];
      const cf = [{ id: 'measurement', population: 'population', value: '562', unit: 'areas', state: bad ? 'completely_destroyed' : 'damaged', extent: 'total', reportSource: 'origin', anchors: [quote(cd)], ambiguous: false }];
      const ef = [{ ...cf[0], state: 'damaged', anchors: [quote(relevantDocs[0])] }];
      c = extraction(family, [cd], cn, cf, ['action_scope']); e = extraction(family, ed, en, ef);
      addPair('measurement', 'measurement'); addLink('population', 'population', 'equivalent'); addLink('origin', 'origin', 'equivalent');
    }
    // Whole-source anchors are intentionally broad: this fixture tests comparator logic,
    // not extraction or fine-grained provenance fidelity. Relevant graphs are manual slices.
    const alignment = validateAlignment({ nodeLinks: links, factPairs: pairs }, c, e, [cd, ...ed]);
    return { originalId: item.originalId, comparison: compare(c, e, alignment, item.registeredResidual), candidate: c, evidence: e, alignment,
      testOnly: true, evidenceHash: item.packet.evidenceHash, claim: cd.text };
  });
}
export function runOracle() {
  const cases = oracleCases();
  return { version: VERSION, kind: 'hand_authored_reference_graph_comparator_test', remoteCalls: 0,
    semanticModelTested: false, cases: cases.map(({ candidate, evidence, alignment, ...c }) => c),
    limitations: ['Manual semantic structures and correspondences; no tested-model output', 'Known development cases, not independent validation', 'Pass applies only to represented obligations; residual scopes are pending', 'Broad fixture anchors do not certify individual field extraction'] };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const out = new URL(`../../../out/atomic-evidence/${VERSION}/oracle/`, import.meta.url).pathname;
  mkdirSync(out, { recursive: true }); const result = runOracle(); atomicWriteJson(`${out}/summary.json`, result);
  console.log(JSON.stringify({ kind: result.kind, cases: result.cases.map(c => ({ id: c.originalId, status: c.comparison.status, issues: c.comparison.receipts.filter(r => r.status !== 'entailed').map(r => r.ruleId) })), remoteCalls: 0, out }, null, 2));
}
