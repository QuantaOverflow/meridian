/**
 * Extract a fixture (frozen articleIds list) from a past brief workflow's
 * prepare_dataset observability step. Use this to A/B prompts with identical
 * input.
 *
 * Usage:
 *   pnpm exec tsx make-fixture.ts --workflow <id> --name <fixture-name>
 *
 * Output: fixtures/<fixture-name>.json
 *
 * Then trigger brief with that fixture's articleIds:
 *   curl -s -X POST http://localhost:8787/admin/briefs/generate \
 *     -H "Content-Type: application/json" \
 *     -d "$(node -e "const f=require('./fixtures/<name>.json');console.log(JSON.stringify({article_ids:f.articleIds,maxStoriesToGenerate:3,minImportance:3,clusteringOptions:{umapParams:{n_neighbors:5,n_components:5,min_dist:0.1,metric:'cosine'},hdbscanParams:{min_cluster_size:3,min_samples:1,epsilon:0.5}},triggeredBy:'eval-fixture-<name>'}))")"
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8787';
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

interface CLIArgs {
  workflowId: string;
  name: string;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: Partial<CLIArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workflow') args.workflowId = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: tsx make-fixture.ts --workflow <id> --name <name>');
      process.exit(0);
    }
  }
  if (!args.workflowId || !args.name) {
    console.error('Both --workflow and --name are required.');
    process.exit(1);
  }
  return args as CLIArgs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const listResp = await fetch(`${BACKEND_URL}/observability/workflows`);
  if (!listResp.ok) throw new Error(`List workflows failed: ${listResp.status}`);
  const list = (await listResp.json()) as {
    workflows: Array<{ key: string; uploaded: string }>;
  };
  const matches = list.workflows
    .filter((w) => w.key.includes(args.workflowId))
    .sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  if (matches.length === 0) {
    throw new Error(`No observability records for workflow ${args.workflowId}`);
  }
  const key = matches[0].key;

  const detailResp = await fetch(
    `${BACKEND_URL}/observability/workflows/${encodeURIComponent(key)}`
  );
  if (!detailResp.ok) throw new Error(`Fetch workflow detail failed: ${detailResp.status}`);
  const detail = (await detailResp.json()) as { detailedMetrics: any[] };

  const step = detail.detailedMetrics.find(
    (m) => m.stepName === 'prepare_dataset' && m.status === 'completed'
  );
  if (!step) throw new Error('prepare_dataset completed step not found');
  const ids: number[] | undefined = step.data?.articleIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(
      'prepare_dataset.data.articleIds missing. Apply T14 workflow patch and re-run a brief first.'
    );
  }

  await mkdir(FIXTURES_DIR, { recursive: true });
  const fixturePath = resolve(FIXTURES_DIR, `${args.name}.json`);
  const fixture = {
    name: args.name,
    sourceWorkflow: args.workflowId,
    extractedAt: new Date().toISOString(),
    articleCount: ids.length,
    articleIds: ids,
  };
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2));
  console.log(`Fixture written: ${fixturePath}`);
  console.log(`Article count: ${ids.length}`);
  console.log(``);
  console.log(`Trigger a brief with this fixture:`);
  console.log(`  curl -s -X POST ${BACKEND_URL}/admin/briefs/generate \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"article_ids":${JSON.stringify(ids.slice(0, 3))}/*...${ids.length - 3} more*/,"maxStoriesToGenerate":3,"minImportance":3,"triggeredBy":"eval-fixture-${args.name}"}'`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
