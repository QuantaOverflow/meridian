// Qualitative reframe probe (v0.20) item set.
// No new items are authored here: every seed is selected by (source,articleId,sentence)
// out of the already-frozen heldout/factor/confirm seed files. Selection is by known
// failure record only; heldout material is already consumed, so nothing here is blind.
import {heldoutSeeds} from './heldout-seeds.mjs';
import {factorSeeds} from './factor-seeds.mjs';
import {confirmSeeds} from './confirm-seeds.mjs';

const pools={heldout:heldoutSeeds,factor:factorSeeds,confirm:confirmSeeds};
const pick=(pool,articleId,sentence)=>{
  const hits=pools[pool].filter(s=>s.articleId===articleId&&s.sentence===sentence);
  if(hits.length!==1)throw Error(`seed selection drift: ${pool}/${articleId}/${sentence} -> ${hits.length}`);
  return hits[0];
};

// 8 known failures (main denominator): 7 actual misses + 1 "blocked but explained wrong".
// `note` records what the frozen report said about this item; it never enters a request.
const FAILURES=[
  {pool:'heldout',articleId:992454,sentence:3,batch:'heldout-v0.19.1',note:'missed: Bravo died before rescue accepted as supported'},
  {pool:'heldout',articleId:1008572,sentence:2,batch:'heldout-v0.19.1',note:'missed: 22.3b/33.4b totals swapped accepted as supported'},
  {pool:'heldout',articleId:992939,sentence:2,batch:'heldout-v0.19.1',note:'missed: Sacks conditional halt negated accepted as supported'},
  {pool:'heldout',articleId:986133,sentence:3,batch:'heldout-v0.19.1',note:'blocked but faithfulness-diagnosis failed: Pentagon no weapons of any kind'},
  {pool:'factor',articleId:993147,sentence:2,batch:'factor-dev-v0.17',note:'missed: ASEAN multilateral/bilateral preference reversed'},
  {pool:'factor',articleId:1007386,sentence:1,batch:'factor-dev-v0.17',note:'missed: 27,000 km2 restated as square miles'},
  {pool:'confirm',articleId:1006837,sentence:3,batch:'confirm-dev-v0.18',note:'missed: Thailand->Cambodia agreement actor swapped'},
  {pool:'confirm',articleId:1008132,sentence:3,batch:'confirm-dev-v0.18',note:'missed: seven homes/two vehicles reversed'},
];

// Normal controls (conflict denominator). The first is the one heldout normal that was
// wrongly blocked; the rest are the paired normals of the 8 failure seeds, each of which
// was correctly judged supported in its own frozen batch.
const CONTROLS=[
  {pool:'heldout',articleId:1009626,sentence:3,batch:'heldout-v0.19.1',note:'known false block: AI actor description'},
  ...FAILURES.map(f=>({...f,note:`paired normal of ${f.note}`})),
];

export const reframeItems=[
  ...FAILURES.map(f=>({...f,kind:'bad',expected:'unsupported',seed:pick(f.pool,f.articleId,f.sentence)})),
  ...CONTROLS.map(c=>({...c,kind:'normal',expected:'supported',seed:pick(c.pool,c.articleId,c.sentence)})),
];

export const reframeCounts={bad:FAILURES.length,normal:CONTROLS.length,total:reframeItems.length};
