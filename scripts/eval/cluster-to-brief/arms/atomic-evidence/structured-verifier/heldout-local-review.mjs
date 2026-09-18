import {readFileSync} from 'node:fs';
import {atomicWriteJson} from '../probe.mjs';
import {hash} from './context-store.mjs';
import {scoreHeldout} from './heldout-score.mjs';
const out=new URL('../../../out/atomic-evidence/heldout-v0.19.1/',import.meta.url).pathname,read=n=>JSON.parse(readFileSync(`${out}/${n}.json`));
const results=read('results'),refs=read('references'),plan=read('plan');
// Main Codex actually read every source window BEFORE calls and all60 retained outputs AFTER calls.
// Never reuse group judgments for another execution; bind to observed snapshot only.
const observedHash='e21884abe6bbd3543f7a65673bfc26f95619ff4109d9e1bc1116df20362175ad';
if(hash(results)!==observedHash)throw Error('fresh LOCAL semantic audit required');
const misses={
  'item-51e60055ed12':'Death-before-rescue candidate accepted supported; reason and selected source instead explicitly say rescued alive/injured. Injected polarity error unrecognized.',
  'item-730ec5cb7127':'Total22.3b/munitions33.4b reversal accepted; reason repeats source total33.4b/munitions22.3b. Amount-to-owner comparison missed.',
  'item-96031f470258':'Not-to-halt candidate accepted supported; reason and source explicitly urge halt under the same existential-threat condition. Negation ignored.',
  'item-35a28e503899':'Correctly blocked zero-weapons claim, but reason also falsely denies that source says sustain a conflict; original and selected receipts say exactly this. Conservative faithful explanation criterion fails.',
};
const normalFalseBlock='item-3cf8c4f11751';
const weakReceipts=new Set(['item-4951a6574215','item-cc93a2654334','item-b77c370ceaaf']);
const audit={version:results.version,resultsHash:observedHash,evaluator:'main_codex_local_nonblind',
  sourceHeldout:true,independentBlindAuthor:false,fullyIndependent:false,remoteJudge:false,
  definition:plan.precommit.evaluation,allRegisteredSourceWindowsRead:true,all60RetainedOutputsReviewed:true,precallReviewHash:hash(read('pre-call-local-reference-review')),
  cases:refs.map(ref=>{const r=results.results.find(x=>x.id===ref.id);if(!r)throw Error('missing retained output');
    return{id:r.id,rawHash:hash(r.raw),referenceReviewed:true,
      injectedErrorIdentified:ref.expected==='unsupported'?!Object.hasOwn(misses,r.id):null,
      receiptExplainsError:ref.expected==='unsupported'?!weakReceipts.has(r.id)&&!Object.hasOwn(misses,r.id):null,
      note:Object.hasOwn(misses,r.id)?misses[r.id]:r.id===normalFalseBlock?
        'Normal control supported: article about video interview calls Norwood world’s first AI actor and artificially intelligent. Model rejected this faithful paraphrase despite selected exact AI-actor text. Gold unchanged after output.':
        weakReceipts.has(r.id)?'Faithful verdict/reason against full registered context, but selected chunk omits decisive detail. Exact-span selection validity does not prove citation adequacy; recorded separately from per-error diagnosis.':
        ref.expected==='unsupported'?'Main Codex confirms retained reason recognizes the injected unsupported detail faithfully against original context; no contradictory factual explanation.':
        'Main Codex confirms normal reference against original context; retained supported output does not introduce a factual contradiction.'};}),
};
const score=scoreHeldout(results,refs,audit,plan);atomicWriteJson(`${out}/local-audit.json`,audit);atomicWriteJson(`${out}/scores.json`,score);
console.log({cases:score.cases,leak:score.releasedErrorRate,strictMiss:score.directErrorDiagnosticMissRate,normalBlocked:score.normalFalseBlockRate,review:score.reviewRate,met:score.observedTargetMet,iidIllustration:score.illustrativeIidUpperEndpoint95,cost:score.cost});
