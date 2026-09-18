import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {hash} from './context-store.mjs';
import {atomicWriteJson} from '../probe.mjs';
const root=new URL('../../../',import.meta.url),out=new URL('../../../out/atomic-evidence/heldout-v0.19.1/',import.meta.url).pathname;
mkdirSync(out,{recursive:true});
const clusters=JSON.parse(readFileSync(new URL('fixtures/clusters.json',root)));
const previous=JSON.parse(readFileSync(new URL('out/atomic-evidence/binding-retest-v0.19.1/plan.json',root)));
const components=['binding-factors.mjs','relation-factors.mjs','surface-factors.mjs','choice-gate.mjs','contracts.mjs','runner.mjs','context-store.mjs','rest-transport.mjs','numeric.mjs'];
const codeHashes=Object.fromEntries(components.map(f=>[f,hash(readFileSync(new URL(f,import.meta.url),'utf8'))]));
for(const f of components)if(codeHashes[f]!==previous.codeHashes[f])throw Error('tested verifier changed before heldout');
const protocol={version:'heldout-v0.19.1',verifierVersion:'binding-retest-v0.19.1',codeHashes,
  clusters:[28,51],selectionSeed:'meridian-final-heldout-2026-09-18-v1',
  articleOrder:Object.fromEntries([28,51].map(k=>[k,[...clusters[k]].sort((a,b)=>hash(`meridian-final-heldout-2026-09-18-v1:${a}`).localeCompare(hash(`meridian-final-heldout-2026-09-18-v1:${b}`)))])),
  articleCountPerCluster:15,groups:30,cases:60,normal:30,errors:30,
  materialPolicy:'Reveal only after this precommit. One normal and one locally authored single-error phrase per article, 15 articles per cluster. Five risk families (quantity, actor/identity, polarity, state/modality, scope/bound) targeted at three per cluster. First self-contained sufficient fact from early source window; select before model calls and without inspecting rule coverage. If an article cannot provide target risk, record alternative risk or reserve replacement BEFORE model calls. Related underlying events may repeat. Not natural error samples or independently blind-authored labels.',
  evaluation:'main Codex local nonblind semantic reading of original source and retained outputs; labels absent from requests. Error identified requires faithful error diagnosis without contradictory factual explanation; explicit correct factor receipts may independently diagnose. Unknown/contract failure not detection; retain all60 in denominator.',
  target:{directDiagnosticMissRateBelow:0.10,normalFalseBlockRateAtMost:0.10,normalAllowAtLeast:0.75,reviewRateAtMost:0.25},
  limits:{logicalCalls:35,httpAttempts:70,knownTokens:110000,timeoutMs:60000},maxRepairs:5,batchSize:2,
  stop:'One final heldout execution; no prompt/schema/factor/routing change or semantic retries based on failures. Finite contract repairs with actual validator feedback only. No production writes/deploy/commit; no remote judge.',
  boundary:'Heldout SOURCE EVENTS not used for tuning; synthetic authored controls, not existing natural-error gold. Article/group counts are NOT independent event counts. Below10 observed rate differs from statistical population guarantee.',
};
const path=`${out}/precommit.json`;
if(existsSync(path)&&hash(JSON.parse(readFileSync(path)))!==hash(protocol))throw Error('precommit drift');
atomicWriteJson(path,protocol);console.log({precommitHash:hash(protocol),codeHashes,selected:Object.fromEntries([28,51].map(k=>[k,protocol.articleOrder[k].slice(0,15)])),out});
