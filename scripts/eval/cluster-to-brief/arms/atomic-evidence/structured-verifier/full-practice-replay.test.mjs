import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildReplay,scoreReplay} from './full-practice-replay.mjs';
import {hash} from './context-store.mjs';
const labels=readFileSync(new URL('../../../gold/practice-risk-v1/labels.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse);
const data=buildReplay();
test('full replay: all60cases and32error spans remain, multi-error parents not collapsed',()=>{
  const score=scoreReplay(data,labels);assert.equal(score.summary.totalCases,60);assert.equal(score.summary.totalErrors,32);
  assert.equal(score.perError.filter(e=>e.caseId==='p18-u').length,2);assert.equal(score.perError.filter(e=>e.caseId==='p26-u').length,2);
  assert.equal(score.summary.legacy.errorsLeaked,3);assert.equal(score.summary.legacy.errorContractReview,1);
});
test('full replay: quantity needs current semantic audit, not substring alone',()=>{
  const without=scoreReplay(data,labels),c=data.cases.find(c=>c.id==='p20-u');assert.equal(without.cases.find(c=>c.id==='p20-u').overlay,'review');
  const audit={artifactHash:hash(data),evaluator:'main_codex_local_nonblind',reviews:[{caseId:c.id,quantityHash:hash(c.quantity),accepted:true}]};
  const withAudit=scoreReplay(data,labels,audit);assert.equal(withAudit.cases.find(c=>c.id==='p20-u').decision,'quantity_diagnosed_block');assert.equal(withAudit.summary.overlay.allowed,29);assert.equal(withAudit.summary.overlay.review,2);
  assert.throws(()=>scoreReplay(data,labels,{...audit,artifactHash:'stale'}));
});
test('full replay: no zero-leak claim without exposing yield, old whole blocks and contract review',()=>{
  const score=scoreReplay(data,labels);assert.equal(score.summary.strict.allowed,0);assert.equal(score.summary.strict.review,32);assert.equal(score.summary.blockOriginsAndReview.legacy_whole_block,26);
  const e=score.perError.find(e=>e.caseId==='p01-u');assert.equal(e.strict,'review');assert.equal(e.legacy,'contract_review');
  assert.ok(score.perError.filter(e=>e.caseId==='p18-u').every(e=>e.overlay==='legacy_whole_blocked'));
});
test('full replay: reference risk categories cannot alter routing; duplicate labels rejected',()=>{
  const altered=labels.map(l=>({...l,risk:'arbitrary',errors:l.errors.map(e=>({...e,risk:'arbitrary'}))}));
  assert.deepEqual(scoreReplay(data,altered).cases.map(c=>c.decision),scoreReplay(data,labels).cases.map(c=>c.decision));
  assert.throws(()=>scoreReplay(data,[...labels,labels[0]]));
});
