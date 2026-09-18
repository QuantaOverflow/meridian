import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freezeExpanded,replayOld} from './expanded-dev.mjs';
import {hash} from './context-store.mjs';
test('expanded frozen40 contains twenty intact new-dev pairs and no reference reasons in calls',()=>{
  const out=mkdtempSync(join(tmpdir(),'meridian-expanded-')),p=freezeExpanded(out),refs=JSON.parse(readFileSync(join(out,'references.json')));
  assert.equal(p.items.length,40);assert.equal(p.batches.length,10);assert.equal(new Set(refs.map(r=>r.group)).size,20);
  assert.equal(p.boundaries.heldoutLoaded,false);assert.equal(p.boundaries.independent,false);
  for(const group of new Set(refs.map(r=>r.group)))assert.deepEqual(refs.filter(r=>r.group===group).map(r=>r.expected).sort(),['supported','unsupported']);
  for(const ref of refs)for(const error of ref.errors){assert.ok(p.items.find(c=>c.id===ref.id).text.includes(error.span));for(const b of p.batches)assert.equal(b.request.prompt.includes(error.reason),false);}
  assert.equal(hash(freezeExpanded(out)),hash(p));
  const regression=replayOld(out);assert.equal(regression.remoteCalls,0);assert.equal(regression.valid,8);
});
