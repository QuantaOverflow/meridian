// All semantic equivalence comes from the independently audited alignment conversion.
// No name matching, synonym table, modality ordering, or damaged/destroyed ontology.
import { canonicalDecimal } from './numeric.mjs';
const unknownValue = value => typeof value !== 'string' || !value.trim() || value.trim().toLowerCase() === 'unknown';
function nodeRelation(alignment, c, e) {
  const links = alignment.nodeLinks.filter(l => l.candidateNodeId === c && l.evidenceNodeId === e);
  return links.length === 1 ? links[0].relation : 'ambiguous';
}
export function compare(candidate, evidence, alignment, registeredResidual = []) {
  if (!['speech', 'scoped_quantity'].includes(candidate.family) || candidate.family !== evidence.family) return { status: 'contract_error', receipts: [], reasonCode: 'family_mismatch' };
  const receipts = [];
  const emit = (fact, status, ruleId, e = null) => receipts.push({ candidateFactId: fact.id, evidenceFactId: e?.id ?? null, status, ruleId, candidateAnchors: fact.anchors, evidenceAnchors: e?.anchors ?? [] });
  const cNodes = new Map(candidate.nodes.map(n => [n.id, n])), eNodes = new Map(evidence.nodes.map(n => [n.id, n]));
  for (const c of candidate.facts) {
    const pairs = alignment.factPairs.filter(p => p.candidateFactId === c.id);
    if (c.ambiguous || pairs.length !== 1 || pairs[0].unresolved) { emit(c, 'unresolved', 'unique_object_alignment_required'); continue; }
    const e = evidence.facts.find(f => f.id === pairs[0].evidenceFactId);
    if (!e || e.ambiguous) { emit(c, 'unresolved', 'evidence_object_missing_or_ambiguous'); continue; }
    if (candidate.family === 'speech') {
      if (cNodes.get(c.proposition)?.ambiguous || eNodes.get(e.proposition)?.ambiguous || nodeRelation(alignment, c.proposition, e.proposition) !== 'equivalent') { emit(c, 'unresolved', 'proposition_identity_required', e); continue; }
      for (const role of ['speaker', 'recipient']) {
        if (role === 'recipient' && c.recipient === '') continue; // candidate does not assert a listener
        const relation = nodeRelation(alignment, c[role], e[role]);
        if (cNodes.get(c[role])?.ambiguous || eNodes.get(e[role])?.ambiguous || relation === 'ambiguous') emit(c, 'unresolved', `${role}_identity_required`, e);
        else emit(c, relation === 'equivalent' ? 'entailed' : 'explicit_conflict', `${role}_edge`, e);
      }
      for (const field of ['reportMode', 'polarity', 'eventState']) {
        if (field === 'eventState' && c[field] === 'unspecified') continue;
        const unmapped = c[field] === 'unknown' || e[field] === 'unknown' || field === 'reportMode' && (c[field] === 'other' || e[field] === 'other');
        const status = unmapped ? 'unresolved' : c[field] === e[field] ? 'entailed' : field === 'polarity' ? 'explicit_conflict' : 'not_established';
        emit(c, status, `same_report_${field}`, e);
      }
    } else {
      if (cNodes.get(c.population)?.ambiguous || eNodes.get(e.population)?.ambiguous || nodeRelation(alignment, c.population, e.population) !== 'equivalent') { emit(c, 'unresolved', 'population_identity_required', e); continue; }
      for (const field of ['unit', 'state']) {
        // These are narrow business enums, not a model's pairwise equivalence verdict.
        const unknown = unknownValue(c[field]) || unknownValue(e[field]) || c[field] === 'other' || e[field] === 'other';
        emit(c, unknown ? 'unresolved' : c[field] === e[field] ? 'entailed' : 'not_established', `same_measurement_${field}`, e);
      }
      if (c.reportSource !== '') {
        const relation = nodeRelation(alignment, c.reportSource, e.reportSource);
        const unknown = !cNodes.has(c.reportSource) || !eNodes.has(e.reportSource) || cNodes.get(c.reportSource)?.ambiguous || eNodes.get(e.reportSource)?.ambiguous;
        emit(c, unknown || relation === 'ambiguous' ? 'unresolved' : relation === 'equivalent' ? 'entailed' : 'not_established', 'same_measurement_reportSource', e);
      }
      try { emit(c, canonicalDecimal(c.value) === canonicalDecimal(e.value) ? 'entailed' : 'not_established', 'same_measurement_decimal_value', e); }
      catch { emit(c, 'unresolved', 'valid_decimal_required', e); }
      if (c.extent !== 'unspecified') emit(c, c.extent === 'unknown' || e.extent === 'unknown' ? 'unresolved' : c.extent === e.extent ? 'entailed' : 'not_established', 'same_measurement_extent', e);
    }
  }
  const residual = candidate.coverage.filter(c => !['none', 'nonfactual'].includes(c.residualCode)).map(c => ({ code: c.residualCode, span: c.span }));
  for (const code of registeredResidual) if (!residual.some(r => r.code === code)) residual.push({ code, span: null, source: 'pre_registered_scope_not_model_input' });
  const missingFactCoverage = candidate.facts.filter(f => !candidate.coverage.some(c => c.factIds.includes(f.id))).map(f => f.id);
  const status = receipts.some(r => r.status === 'explicit_conflict') ? 'conflict' : !receipts.length || residual.length || missingFactCoverage.length || candidate.needsContext.length || evidence.needsContext.length || receipts.some(r => r.status !== 'entailed') ? 'pending' : 'pass';
  return { status, receipts, residual, missingFactCoverage, semanticCoverageVerified: false, note: 'pass remains subject to independent extraction/alignment semantic audit; pending is not successful error detection' };
}
