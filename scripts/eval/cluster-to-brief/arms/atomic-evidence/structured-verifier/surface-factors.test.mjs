import test from 'node:test';
import assert from 'node:assert/strict';
import {compareSurfaceFactors,overlayFactors} from './surface-factors.mjs';
const compare=(c,e)=>compareSurfaceFactors({sourceId:'candidate',text:c},e.map((text,i)=>({sourceId:`source-${i}`,text})));
test('full event destinations bind planned/completed rather than unrelated state cues',()=>{
  assert.equal(compare('A report already presented to the Council this week.',['A report to be presented to the Council this week.']).diagnoses.length,1);
  assert.equal(compare('A report already presented to a different Council.',['A report to be presented to the Council this week.']).diagnoses.length,0);
  assert.equal(compare('X has already appeared before Judge Stone in Rome for a hearing.',['He is scheduled to appear before Judge Stone in Rome for a hearing, according to records.']).diagnoses.length,1);
});
test('explicit bounds preserve population/action/context and entailment direction',()=>{
  const c='Exactly 7 people were injured in a gas leak in City A.';
  assert.equal(compare(c,['At least 7 people have been injured in a gas leak in City A.']).diagnoses.length,1);
  assert.equal(compare(c,['At least 7 people have been injured in a different accident.']).diagnoses.length,0);
  assert.equal(compare('At least 7 people were injured in a gas leak in City A.',['Exactly 7 people were injured in a gas leak in City A.']).diagnoses.length,0);
});
test('limited active-stage grammar binds the same full object, never mismatching units/objects',()=>{
  assert.equal(compare('A has already acquired uranium technology.',['A is set to acquire uranium technology.']).diagnoses.length,1);
  assert.equal(compare('A has already acquired plutonium technology.',['A is set to acquire uranium technology.']).diagnoses.length,0);
  assert.equal(compare('A will acquire uranium technology.',['A has already acquired uranium technology.']).diagnoses.length,1);
});
test('want polarity includes exact actor and entire object',()=>{
  assert.equal(compare('President Jane Smith says he wants Town to depend solely on oil.',['President Jane Smith insists he does not want Town to depend solely on oil.']).diagnoses.length,1);
  assert.equal(compare('President Jane Smith says he wants Town to depend solely on oil.',['President Other Person insists he does not want Town to depend solely on oil.']).diagnoses.length,0);
});
test('office-change aligns full action/patient/office before comparing typed actor',()=>{
  assert.equal(compare('Country’s parliament removed Jones as finance minister on Monday.',['President Jane Smith abruptly removed Jones as finance minister on Monday.']).diagnoses.length,1);
  assert.equal(compare('Country’s parliament removed Brown as finance minister on Monday.',['President Jane Smith abruptly removed Jones as finance minister on Monday.']).diagnoses.length,0);
});
test('exclusion binds exact listed example/category; no subject or class keyword guesses',()=>{
  const source='Digital banks in this context are standalone businesses, as opposed to digital offshoots of existing banks like Acme in Italy or Peer Bank in France.';
  assert.equal(compare('Acme in Italy is a standalone digital bank rather than an offshoot.',[source]).diagnoses.length,1);
  assert.equal(compare('Other Bank in Italy is a standalone digital bank rather than an offshoot.',[source]).diagnoses.length,0);
});
test('conditional/conflicting evidence is pending, not correct rejection; unknown does not become pass',()=>{
  assert.equal(compare('A report already presented to the Council this week.',['If a report to be presented to the Council this week.']).diagnoses.length,0);
  const g=compare('A report already presented to the Council this week.',['A report to be presented to the Council this week.','A report already presented to the Council this week.']);
  assert.equal(g.diagnoses.length,0);assert.equal(overlayFactors({route:'allow'},g).route,'review');
  assert.equal(g.coverageVerified,false);
});
