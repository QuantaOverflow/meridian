import test from 'node:test';
import assert from 'node:assert/strict';
import {compareBindingFactors} from './binding-factors.mjs';
const doc=text=>({sourceId:'x',text});
test('damage quantities retain population and location binding',()=>{
  const source=doc('Houthi attacks on Abha and Taif caused injuries, damaging seven homes and two vehicles.');
  assert.equal(compareBindingFactors(doc('Houthi attacks on Abha and Taif damaged two homes and seven vehicles.'),[source]).diagnoses.length,2);
  assert.equal(compareBindingFactors(doc('Houthi attacks on Abha and Taif damaged seven homes and two vehicles.'),[source]).diagnoses.length,0);
  assert.equal(compareBindingFactors(doc('Houthi attacks on Elsewhere damaged two homes and seven vehicles.'),[source]).diagnoses.length,0);
});
test('people and accounts belong to distinct seizure slots',()=>{
  const source=doc("Iran's judiciary has seized assets belonging to 240 dissidents, journalists and public figures and frozen 182 of their bank accounts.");
  assert.equal(compareBindingFactors(doc("Iran’s judiciary seized assets belonging to 182 dissidents, journalists and public figures and froze 240 of their bank accounts."),[source]).diagnoses.length,2);
});
test('agreement actor aligns exact patient, not unrelated termination',()=>{
  const p='a 25-year-old memorandum of understanding meant to resolve overlapping maritime claims';
  assert.equal(compareBindingFactors(doc(`Cambodia terminated ${p} with Thailand.`),[doc(`after Thailand terminated ${p}.`)]).diagnoses.length,1);
  assert.equal(compareBindingFactors(doc('Cambodia terminated an unrelated agreement.'),[doc(`Thailand terminated ${p}.`)]).diagnoses.length,0);
});
