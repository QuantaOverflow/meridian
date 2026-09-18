import {readFileSync} from 'node:fs';
import {atomicWriteJson} from '../probe.mjs';
import {hash} from './context-store.mjs';
const out=new URL('../../../out/atomic-evidence/expanded-dev-v0.16.1/',import.meta.url).pathname;
const read=name=>JSON.parse(readFileSync(`${out}/${name}.json`));
const results=read('results'),refs=read('references');
// Explicit main-Codex judgments after reading all40 retained outputs and registered source windows.
// Bind to ONLY that observed snapshot; never auto-certify a rerun by reusing group labels.
const expectedHash='710987358b3e52f4a803a2aeba09953c392d988a9df6eebdbfa586e25e6c418d';
if(hash(results)!==expectedHash)throw Error('reviewed results changed; fresh local semantic review required');
const badJudgments={
  'korea-nominee':[true,'Reason and anchor explicitly preserve before rather than after confirmation.'],
  'kosovo-vote':[true,'Reason identifies62 vs82 lawmakers with an exact supporting receipt.'],
  'whoosh-debt':[true,'80-year source debt period distinguished from40-year candidate.'],
  'digital-bank-definition':[false,'Retained supported verdict misses that Jenius is an offshoot excluded from standalone banks; invalid quote happens to prevent release.'],
  'india-foreign-charges':[true,'Charging under immigration law does not establish acquittal of all charges; source quote supports this diagnosis.'],
  'singapore-visit':[true,'Reason explicitly identifies has completed vs set to/will; errorSpan incorrectly anchors speech rather than completion, so anchor precision is insufficient.'],
  'indonesia-minister':[false,'Supported verdict repeats president from evidence but overlooks parliament as the candidate actor.'],
  'myanmar-russia-agreements':[true,'Reason identifies missing broader economic cooperation under only; quote contract failure keeps case in review.'],
  'belarus-report':[false,'Supported verdict collapses report to be presented into already presented.'],
  'vermont-plea':[true,'Not-guilty vs guilty correctly diagnosed.'],
  'west-virginia-bail':[true,'40000 vs4000 bail correctly diagnosed.'],
  'holocaust-train':[true,'Reason identifies American vs Soviet troops faithfully to source; selected exact quotes fail to include the decisive American-troops detail.'],
  'costco-purchase-limit':[true,'Kirkland two-box weekly limit distinguished from claimed five.'],
  'aqaba-gas-leak':[false,'Supported verdict strengthens at least11 into exactly11.'],
  'mecca-rain-warning':[true,'Flood warning vs no-risk confirmation correctly diagnosed.'],
  'pakistan-austerity':[true,'Reviewing possible revival does not establish all measures already brought back.'],
  'guyana-oil-dependence':[false,'Supported verdict cites does not want but misses candidate wants; negation is lost.'],
  'venezuela-murals':[true,'Added national legal ban/causal explanation absent from registered context; absence is unsupported, not proof the law does not exist in the world.'],
  'niger-mutiny':[true,'False circulated removal declaration is not actual completed removal.'],
  'saab-plea-plan':[false,'Scheduled appearance is wrongly accepted as has already appeared.'],
};
const audit={version:results.version,resultsHash:expectedHash,evaluator:'main_codex_local_nonblind',independent:false,
  contextSufficiencyReviewed:true,heldoutLoaded:false,remoteJudge:false,
  definition:'error identified means reason faithfully recognizes the injected error against source; neither contract receipt completeness nor operational blocking is implied',
  cases:refs.map(ref=>{
    const result=results.results.find(r=>r.id===ref.id),judgment=badJudgments[ref.group];if(!result||!judgment)throw Error('missing reviewed case');
    return{id:ref.id,rawHash:hash(result.raw),referenceReviewed:true,
      injectedErrorIdentified:ref.expected==='unsupported'?judgment[0]:null,
      receiptExplainsError:ref.expected==='unsupported'&&judgment[0]?result.contractValid&&ref.group!=='holocaust-train':null,
      anchorPrecisionSufficient:ref.expected==='unsupported'&&judgment[0]?ref.group!=='singapore-visit':null,
      note:ref.expected==='unsupported'?judgment[1]:'Normal reference locally reviewed against registered original context; exact control support exists. No semantic correction fed into tested route.'};
  })};
atomicWriteJson(`${out}/local-audit.json`,audit);console.log({cases:audit.cases.length,resultsHash:expectedHash,missedErrors:audit.cases.filter(c=>c.injectedErrorIdentified===false).length});
