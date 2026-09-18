import { test } from 'node:test';
import assert from 'node:assert/strict';
import {bindingsOk,bindingPrompt} from './relation-probe.mjs';
const cases=[{id:'item1',text:'A said B.',evidence:[{text:'A said B.'}]}];
const pair={candidateSpan:'A',candidateRelation:'speaker=A',evidenceRelation:'speaker=A',sourceIndex:1,quote:'A said',status:'supported'};
const wrap=p=>({results:[{id:'item1',pairs:[p]}]});
test('exact spans and local evidence contract',()=>{assert.ok(bindingsOk(wrap(pair),cases));assert.equal(bindingsOk(wrap({...pair,quote:'X said'}),cases),false);assert.equal(bindingsOk(wrap({...pair,candidateSpan:'X'}),cases),false);assert.equal(bindingsOk(wrap({...pair,sourceIndex:2}),cases),false);});
test('missing evidence cannot support',()=>{assert.equal(bindingsOk(wrap({...pair,sourceIndex:0,quote:''}),cases),false);assert.ok(bindingsOk(wrap({...pair,sourceIndex:0,quote:'',status:'uncertain'}),cases));});
test('prompt only serializes opaque identifiers and content',()=>{const prompt=bindingPrompt([{...cases[0],originalId:'p11-u',expected:'unsupported'}]);assert.equal(prompt.includes('p11-u'),false);assert.equal(prompt.includes('expected'),false);});
