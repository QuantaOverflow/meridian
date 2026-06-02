import type { EvalReport, Verdict } from './types.js';

function escapePipe(s: string): string {
  return s.replace(/\|/g, '\\|');
}

export function renderMarkdown(r: EvalReport): string {
  const lines: string[] = [];

  lines.push(`# Eval Report — ${r.workflowId}`);
  lines.push('');
  lines.push('## Run metadata');
  lines.push(`- prompt_hash: ${r.promptHash}`);
  lines.push(`- judge_model: ${r.judgeModel}`);
  lines.push(`- eval_timestamp: ${r.timestamp}`);
  lines.push('');

  const counts: Record<Verdict, number> = { REAL: 0, BORDERLINE: 0, FAKE: 0 };
  for (const e of r.evaluations) counts[e.finalVerdict]++;
  const qualityRate =
    r.evaluations.length === 0 ? 0 : (counts.REAL / r.evaluations.length) * 100;

  lines.push('## Aggregate');
  lines.push(`- candidates (valid+rejected from workflow): ${r.candidateCount}`);
  lines.push(`- llm passed (valid): ${r.passedCount}`);
  lines.push(`- after eval: ${counts.REAL} REAL / ${counts.BORDERLINE} BORDERLINE / ${counts.FAKE} FAKE`);
  lines.push(`- quality rate (REAL / passed): ${qualityRate.toFixed(1)}%`);
  lines.push('');

  const hasMultiPass = r.evaluations.some((e) => e.judge.passes && e.judge.passes > 1);

  lines.push('## Per-story');
  if (hasMultiPass) {
    lines.push('| # | title | judge | agree | heuristics | final |');
    lines.push('|---|---|---|---|---|---|');
  } else {
    lines.push('| # | title | judge | heuristics | final |');
    lines.push('|---|---|---|---|---|');
  }
  r.evaluations.forEach((e, i) => {
    const title =
      e.story.title.length > 80 ? e.story.title.slice(0, 77) + '...' : e.story.title;
    const h = e.heuristic.flags.join(', ') || '—';
    if (hasMultiPass) {
      const agreement = e.judge.passes
        ? `${Math.round((e.judge.agreement || 0) * e.judge.passes)}/${e.judge.passes}`
        : '—';
      const lowConf = e.judge.passes && (e.judge.agreement || 1) < 1 ? ' ⚠️' : '';
      lines.push(
        `| ${i + 1} | ${escapePipe(title)} | ${e.judge.verdict} | ${agreement}${lowConf} | ${h} | **${e.finalVerdict}** |`
      );
    } else {
      lines.push(
        `| ${i + 1} | ${escapePipe(title)} | ${e.judge.verdict} | ${h} | **${e.finalVerdict}** |`
      );
    }
  });
  lines.push('');

  if (hasMultiPass) {
    const lowConfCount = r.evaluations.filter(
      (e) => e.judge.passes && (e.judge.agreement || 1) < 1
    ).length;
    if (lowConfCount > 0) {
      lines.push(
        `> ⚠️ ${lowConfCount} story(ies) had judge disagreement across passes — verdict less reliable.`
      );
      lines.push('');
    }
  }

  lines.push('## Per-story detail');
  r.evaluations.forEach((e, i) => {
    lines.push(`### ${i + 1}. ${e.story.title}`);
    lines.push(`- articles: ${e.story.articleIds.length}, importance: ${e.story.importance}`);
    lines.push(`- final verdict: **${e.finalVerdict}**`);
    const confLine = e.judge.passes
      ? ` [agreement ${Math.round((e.judge.agreement || 0) * e.judge.passes)}/${e.judge.passes}, votes ${(e.judge.votes || []).join('/')}]`
      : '';
    lines.push(
      `- judge: ${e.judge.verdict}${confLine} (coherence ${e.judge.coherence}/5, title_fit ${e.judge.title_fit}/5)`
    );
    lines.push(`  reason: ${e.judge.reason}`);
    if (e.heuristic.flags.length) {
      lines.push(`- heuristic flags:`);
      for (const f of e.heuristic.flags) {
        lines.push(`  - ${f}: ${e.heuristic.details[f]}`);
      }
    }
    lines.push('');
  });

  if (r.rejectedClusters.length) {
    lines.push('## Rejected by upstream LLM');
    const reasons: Record<string, number> = {};
    for (const rc of r.rejectedClusters) {
      reasons[rc.rejectionReason] = (reasons[rc.rejectionReason] || 0) + 1;
    }
    lines.push(`- counts: ${Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    lines.push('');
  }

  // Pain 1: 被错杀检查
  if (r.rejectedSample?.length) {
    const sample = r.rejectedSample;
    const missed = sample.filter((s) => s.judge.verdict === 'MISSED_STORY').length;
    const debatable = sample.filter((s) => s.judge.verdict === 'DEBATABLE').length;
    const correct = sample.filter((s) => s.judge.verdict === 'CORRECT_REJECTION').length;
    const missedRate = (missed / sample.length) * 100;
    lines.push('## Over-rejection check (sampled rejected clusters)');
    lines.push(`- sample size: ${sample.length} (of ${r.rejectedClusters.length} rejected)`);
    lines.push(`- verdicts: ${correct} CORRECT / ${debatable} DEBATABLE / ${missed} MISSED_STORY`);
    lines.push(
      `- missed-story rate (in sample): ${missedRate.toFixed(1)}%${missed > 0 ? '  ⚠️ upstream may be over-rejecting' : ''}`
    );
    lines.push('');
    lines.push('### Sampled rejected details');
    sample.forEach((s, i) => {
      lines.push(
        `**${i + 1}. cluster ${s.cluster.clusterId} (${s.cluster.rejectionReason}, ${s.articles.length} articles) → ${s.judge.verdict}**`
      );
      lines.push(`  reason: ${s.judge.reason}`);
      const titles = s.articles.slice(0, 5).map((a) => `  - [${a.id}] ${a.title}`);
      lines.push(titles.join('\n'));
      if (s.articles.length > 5) lines.push(`  ... (${s.articles.length - 5} more articles)`);
      lines.push('');
    });
  }

  return lines.join('\n');
}
