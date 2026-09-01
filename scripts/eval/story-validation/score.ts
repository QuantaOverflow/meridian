import { authHeaders } from '../_shared/backend.js';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHeuristics, detectSplitOverlap } from './heuristics.js';
import { judgeStory, judgeRejected } from './judge.js';
import { renderMarkdown } from './report.js';
import type {
  StoryValidationStepData,
  ArticleInfo,
  StoryEvaluation,
  RejectedClusterEvaluation,
  EvalReport,
  Verdict,
} from './types.js';

const REJECTED_SAMPLE_MAX = Number(process.env.REJECTED_SAMPLE_MAX || '5');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8787';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const REPORTS_DIR = resolve(REPO_ROOT, 'eval-reports');

interface CLIArgs {
  workflowId: string;
  judgeModel: string;
  passes: number;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: Partial<CLIArgs> = { judgeModel: 'qwen-plus', passes: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workflow') args.workflowId = argv[++i];
    else if (a === '--judge-model') args.judgeModel = argv[++i];
    else if (a === '--passes') args.passes = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  if (!args.workflowId) {
    printHelp();
    process.exit(1);
  }
  return args as CLIArgs;
}

function printHelp() {
  console.log(`Usage: pnpm score -- --workflow <id> [--judge-model qwen-plus] [--passes 1|3|5]

Reads workflow story_validation step from backend observability,
runs heuristics + LLM judge per story, writes markdown report to
eval-reports/<workflowId>.md.

--passes N (default 1): repeat judge N times per story, take majority vote.
  N=3 recommended for production A/B; N=1 is fastest, only direction-of-change reliable.

Env:
  BACKEND_URL          default http://localhost:8787
  AI_WORKER_URL        default http://localhost:8788  (used by judge.ts)
  REJECTED_SAMPLE_MAX  default 5
`);
}

async function fetchWorkflowData(workflowId: string): Promise<StoryValidationStepData> {
  const listResp = await fetch(`${BACKEND_URL}/observability/workflows`, { headers: authHeaders() });
  if (!listResp.ok) throw new Error(`List workflows failed: ${listResp.status}`);
  const list = (await listResp.json()) as {
    workflows: Array<{ key: string; uploaded: string }>;
  };
  const matches = list.workflows
    .filter((w) => w.key.includes(workflowId))
    .sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  if (matches.length === 0)
    throw new Error(`No observability records for workflow ${workflowId}`);
  const key = matches[0].key;

  const detailResp = await fetch(
    `${BACKEND_URL}/observability/workflows/${encodeURIComponent(key)}`,
    { headers: authHeaders() }
  );
  if (!detailResp.ok) throw new Error(`Fetch workflow detail failed: ${detailResp.status}`);
  const detail = (await detailResp.json()) as { detailedMetrics: any[] };

  const step = detail.detailedMetrics.find(
    (m) => m.stepName === 'story_validation' && m.status === 'completed'
  );
  if (!step) throw new Error('story_validation completed step not found in workflow data');
  const data = step.data as StoryValidationStepData;
  if (!Array.isArray((data as any).stories)) {
    throw new Error(
      'Workflow observability does not contain full stories[]. Apply Task 1 (workflow patch) and re-run the brief first.'
    );
  }
  return data;
}

async function fetchArticles(ids: number[]): Promise<Map<number, ArticleInfo>> {
  if (ids.length === 0) return new Map();
  const resp = await fetch(`${BACKEND_URL}/admin/articles/by-ids`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ids }),
  });
  if (!resp.ok) {
    console.warn(
      `[score] /admin/articles/by-ids returned ${resp.status} — judge will run without article titles.`
    );
    return new Map();
  }
  const data = (await resp.json()) as { articles: ArticleInfo[] };
  return new Map(data.articles.map((a) => [a.id, a]));
}

function mergeVerdict(judge: Verdict, heuristicFlagCount: number): Verdict {
  if (heuristicFlagCount >= 2 && judge === 'REAL') return 'BORDERLINE';
  return judge;
}

async function computePromptHash(): Promise<string> {
  const path = resolve(
    REPO_ROOT,
    'services/meridian-ai-worker/src/prompts/storyValidation.ts'
  );
  try {
    const content = await readFile(path, 'utf8');
    return createHash('sha1').update(content).digest('hex').slice(0, 8);
  } catch {
    return 'unknown';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[score] workflow=${args.workflowId} passes=${args.passes} model=${args.judgeModel}`);

  const data = await fetchWorkflowData(args.workflowId);
  console.log(
    `[score] fetched ${data.stories.length} valid stories, ${data.rejectedClusters.length} rejected`
  );

  // 抽样被拒聚类（pain 1）—— 体量大时按 originalArticleIds 降序取前 N（更可能是 missed real story）
  const sampledRejected = [...data.rejectedClusters]
    .sort((a, b) => (b.originalArticleIds?.length || 0) - (a.originalArticleIds?.length || 0))
    .slice(0, REJECTED_SAMPLE_MAX);

  // 一次性收集所有 article id（valid + sampled rejected）
  const allIds = [
    ...new Set([
      ...data.stories.flatMap((s) => s.articleIds),
      ...sampledRejected.flatMap((c) => c.originalArticleIds || []),
    ]),
  ];
  const articleMap = await fetchArticles(allIds);
  console.log(`[score] fetched info for ${articleMap.size}/${allIds.length} articles`);

  const overlapMap = detectSplitOverlap(data.stories);
  const evals: StoryEvaluation[] = [];
  for (let i = 0; i < data.stories.length; i++) {
    const story = data.stories[i];
    const heuristic = runHeuristics(story, i, overlapMap);
    const articles = story.articleIds
      .map((id) => articleMap.get(id))
      .filter((a): a is ArticleInfo => !!a);
    process.stdout.write(`[score] judging story ${i + 1}/${data.stories.length}... `);
    const judge = await judgeStory(story, articles, {
      model: args.judgeModel,
      passes: args.passes,
    });
    const confTag = judge.agreement !== undefined ? ` (${Math.round(judge.agreement * args.passes)}/${args.passes})` : '';
    process.stdout.write(`${judge.verdict}${confTag}\n`);
    const finalVerdict = mergeVerdict(judge.verdict, heuristic.flags.length);
    evals.push({ story, heuristic, judge, finalVerdict });
  }

  // Pain 1: 抽样判 rejected
  const rejectedEvals: RejectedClusterEvaluation[] = [];
  for (let i = 0; i < sampledRejected.length; i++) {
    const cluster = sampledRejected[i];
    const articles = (cluster.originalArticleIds || [])
      .map((id) => articleMap.get(id))
      .filter((a): a is ArticleInfo => !!a);
    if (articles.length < 2) continue; // 1 篇没法形成 story，跳过
    process.stdout.write(`[score] judging rejected ${i + 1}/${sampledRejected.length}... `);
    const judge = await judgeRejected(cluster, articles, { model: args.judgeModel });
    process.stdout.write(`${judge.verdict}\n`);
    rejectedEvals.push({ cluster, articles, judge });
  }

  const report: EvalReport = {
    workflowId: args.workflowId,
    promptHash: await computePromptHash(),
    judgeModel: args.judgeModel,
    timestamp: new Date().toISOString(),
    candidateCount: data.stories.length + data.rejectedClusters.length,
    passedCount: data.stories.length,
    evaluations: evals,
    rejectedClusters: data.rejectedClusters,
    rejectedSample: rejectedEvals.length ? rejectedEvals : undefined,
  };

  const md = renderMarkdown(report);
  await mkdir(REPORTS_DIR, { recursive: true });
  const outPath = resolve(REPORTS_DIR, `${args.workflowId}.md`);
  await writeFile(outPath, md, 'utf8');
  console.log(`[score] report written: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
