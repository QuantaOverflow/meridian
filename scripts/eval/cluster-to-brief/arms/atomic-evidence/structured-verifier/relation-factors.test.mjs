import test from 'node:test';
import assert from 'node:assert/strict';
import {compareRelationFactors} from './relation-factors.mjs';
const compare=(c,s)=>compareRelationFactors({sourceId:'candidate',text:c},s.map((text,i)=>({sourceId:`s${i}`,text})));
test('paired area counts stay bound to same units and same population',()=>{
  const source='The claim concerns 25,000 sq km (9,652 square miles) of seabed.';
  assert.equal(compare('The claim concerns 25,000 square miles of seabed.',[source]).diagnoses.length,1);
  assert.equal(compare('The claim concerns 25,000 square kilometres of seabed.',[source]).diagnoses.length,0);
  assert.equal(compare('The claim concerns 25,000 square miles of forest.',[source]).diagnoses.length,0);
});
test('preference is paired branch direction, not a bilateral keyword cue',()=>{
  const source='Governments prefer to negotiate with North African countries through a multilateral framework, as opposed to bilaterally with each country.';
  assert.equal(compare('Governments prefer to negotiate bilaterally with each North African country rather than through a multilateral framework.',[source]).diagnoses.length,1);
  assert.equal(compare('Governments prefer to negotiate bilaterally with each South American country rather than through a multilateral framework.',[source]).diagnoses.length,0);
});
test('import scope binds actor/event and does not use nationality/fixture lookup',()=>{
  const source='The foreign secretary, Jane Smith last week announced an import ban on goods from illegal Example settlements in District.';
  assert.equal(compare('Foreign Secretary Jane Smith announced an import ban on all goods from Country last week.',[source]).diagnoses.length,1);
  assert.equal(compare('Foreign Secretary Other Person announced an import ban on all goods from Country last week.',[source]).diagnoses.length,0);
});
test('reporting actor binds complete same proposition; pronouns do not become named identities',()=>{
  assert.equal(compare('President Jane Smith said Washington is in close contact with Country A.',['Jones said Washington is in close contact with Country A.']).diagnoses.length,1);
  assert.equal(compare('Jane Smith said Washington is in close contact with Country A.',['Smith said Washington is in close contact with Country A.']).diagnoses.length,0);
  assert.equal(compare('Jane Smith said Washington is in close contact with Country A.',['He said Washington is in close contact with Country A.']).diagnoses.length,0);
});
