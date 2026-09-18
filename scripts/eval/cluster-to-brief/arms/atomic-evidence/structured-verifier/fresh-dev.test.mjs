import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freezeFresh} from './fresh-dev.mjs';
import {hash} from './context-store.mjs';
test('fresh protocol freezes four intact pairs without heldout or reference leakage',()=>{
  const out=mkdtempSync(join(tmpdir(),'meridian-fresh-test-'));
  const p=freezeFresh(out),refs=JSON.parse(readFileSync(join(out,'references.json')));
  assert.equal(p.items.length,8);assert.equal(p.requests.length,5);
  assert.equal(p.boundaries.heldoutLoaded,false);assert.equal(p.boundaries.independent,false);
  assert.equal(new Set(refs.map(r=>r.group)).size,4);
  for(const group of new Set(refs.map(r=>r.group)))assert.deepEqual(refs.filter(r=>r.group===group).map(r=>r.expected).sort(),['supported','unsupported']);
  for(const r of refs)for(const error of r.errors)for(const request of p.requests)assert.equal(request.request.prompt.includes(error.reason),false);
  assert.equal(hash(freezeFresh(out)),hash(p));
  assert.ok(p.items.every(c=>!c.packet.truncated&&c.evidence.length>1));
});
