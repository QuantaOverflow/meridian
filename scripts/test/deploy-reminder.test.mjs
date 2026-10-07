// scripts/deploy.sh 的「部署生产时没有绿的 Staging 运行就提醒」——只测对外行为：
// 退出码、stderr 里有没有警告、假 wrangler 有没有被调到。
// 每个用例建一个临时 git 仓库（带 apps/backend 等 service 目录），WRANGLER_BIN 指到假的可执行文件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPLOY_SH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'deploy.sh');
const SERVICE_DIRS = ['apps/backend', 'services/meridian-ai-worker', 'services/meridian-ml-service/cf-worker'];

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** 临时仓库：一次提交，工作区干净。假 wrangler 把收到的参数一行一个写进 calls 文件，退出码取 FAKE_EXIT。 */
function makeRepo() {
  const base = mkdtempSync(join(tmpdir(), 'deploy-reminder-'));
  const root = join(base, 'repo');
  mkdirSync(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 't');
  for (const dir of SERVICE_DIRS) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'wrangler.jsonc'), '{}\n');
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  const callsFile = join(base, 'calls');
  const fake = join(base, 'fake-wrangler.sh');
  writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > "${callsFile}"\nexit "\${FAKE_EXIT:-0}"\n`);
  chmodSync(fake, 0o755);
  const head = git(root, 'rev-parse', '--short', 'HEAD');
  const verdictsFile = join(base, 'verdicts.jsonl');
  return { root, callsFile, fake, head, verdictsFile };
}

function line({ head, verdict = 'green', backend = {}, aiWorker = {} }) {
  return JSON.stringify({
    at: '2026-10-07T00:00:00.000Z',
    workflowId: 'cron-brief-1',
    verdict,
    flags: [],
    services: {
      backend: { commit: head, dirty: false, ...backend },
      'ai-worker': { commit: head, dirty: false, ...aiWorker },
    },
  });
}

function deploy(repo, dir, args = [], extraEnv = {}) {
  const r = spawnSync('bash', [DEPLOY_SH, ...args], {
    cwd: join(repo.root, dir),
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_BIN: repo.fake, STAGING_VERDICTS_FILE: repo.verdictsFile, ...extraEnv },
  });
  const wranglerCalled = existsSync(repo.callsFile);
  const calls = wranglerCalled ? readFileSync(repo.callsFile, 'utf8').split('\n').filter(Boolean) : [];
  return { ...r, wranglerCalled, calls, warned: r.stderr.includes('node scripts/staging-run.mjs') };
}

test('记录里有当前提交的绿运行：不警告，wrangler 照常被调', () => {
  const repo = makeRepo();
  writeFileSync(repo.verdictsFile, line({ head: repo.head }) + '\n');
  const r = deploy(repo, 'apps/backend');
  assert.equal(r.status, 0);
  assert.equal(r.warned, false);
  assert.equal(r.wranglerCalled, true);
});

test('黄也算有', () => {
  const repo = makeRepo();
  writeFileSync(repo.verdictsFile, line({ head: repo.head, verdict: 'yellow' }) + '\n');
  assert.equal(deploy(repo, 'services/meridian-ai-worker').warned, false);
});

test('记录里没有当前提交：警告写明当前提交，wrangler 照常被调，退出码是 wrangler 的', () => {
  const repo = makeRepo();
  writeFileSync(repo.verdictsFile, line({ head: 'deadbee' }) + '\n');
  const r = deploy(repo, 'apps/backend', [], { FAKE_EXIT: '7' });
  assert.equal(r.warned, true);
  assert.ok(r.stderr.includes(repo.head));
  assert.equal(r.wranglerCalled, true);
  assert.equal(r.status, 7);
});

test('记录文件不存在按没有处理', () => {
  const repo = makeRepo();
  const r = deploy(repo, 'apps/backend');
  assert.equal(r.warned, true);
  assert.equal(r.wranglerCalled, true);
  assert.equal(r.status, 0);
});

test('红的记录、一个 worker 提交不符、dirty 的记录、取不到提交的记录都不算有', () => {
  for (const content of [
    (h) => line({ head: h, verdict: 'red' }),
    (h) => line({ head: h, aiWorker: { commit: 'deadbee' } }),
    (h) => line({ head: h, backend: { dirty: true } }),
    (h) => line({ head: h, backend: { commit: null, dirty: null } }),
  ]) {
    const repo = makeRepo();
    writeFileSync(repo.verdictsFile, content(repo.head) + '\n');
    assert.equal(deploy(repo, 'apps/backend').warned, true);
  }
});

test('多行记录里任意一行满足即可；坏行被跳过', () => {
  const repo = makeRepo();
  writeFileSync(repo.verdictsFile, ['not json', line({ head: 'deadbee' }), line({ head: repo.head })].join('\n') + '\n');
  assert.equal(deploy(repo, 'apps/backend').warned, false);
});

test('记录里的提交是长哈希也按前缀比', () => {
  const repo = makeRepo();
  const full = git(repo.root, 'rev-parse', 'HEAD');
  writeFileSync(repo.verdictsFile, line({ head: full }) + '\n');
  assert.equal(deploy(repo, 'apps/backend').warned, false);
});

test('当前工作区 dirty：即使记录匹配也警告', () => {
  const repo = makeRepo();
  writeFileSync(repo.verdictsFile, line({ head: repo.head }) + '\n');
  writeFileSync(join(repo.root, 'apps/backend/untracked.txt'), 'x');
  const r = deploy(repo, 'apps/backend');
  assert.equal(r.warned, true);
  assert.equal(r.wranglerCalled, true);
});

test('--env staging 与 --env=staging：不查，wrangler 被调且不再追加顶层环境参数', () => {
  for (const args of [['--env', 'staging'], ['--env=staging']]) {
    const repo = makeRepo();
    const r = deploy(repo, 'apps/backend', args);
    assert.equal(r.warned, false);
    assert.equal(r.wranglerCalled, true);
    assert.ok(r.calls.includes('staging') || r.calls.includes('--env=staging'));
    assert.ok(!r.calls.includes('--env='));
  }
});

test('--print：不查、不调 wrangler', () => {
  const repo = makeRepo();
  const r = deploy(repo, 'apps/backend', ['--print']);
  assert.equal(r.status, 0);
  assert.equal(r.warned, false);
  assert.equal(r.wranglerCalled, false);
});

test('ml-service 目录：不查，wrangler 被调，不追加 --env=', () => {
  const repo = makeRepo();
  const r = deploy(repo, 'services/meridian-ml-service/cf-worker');
  assert.equal(r.warned, false);
  assert.equal(r.wranglerCalled, true);
  assert.ok(!r.calls.includes('--env='));
});

test('不带 --env 部署 backend / ai-worker：显式带上顶层环境 --env=（消掉 wrangler 的多环境 warning）', () => {
  for (const dir of ['apps/backend', 'services/meridian-ai-worker']) {
    const repo = makeRepo();
    const r = deploy(repo, dir);
    assert.ok(r.calls.includes('--env='), `${dir}: ${r.calls.join(' ')}`);
  }
});

test('--print 的输出里也含 --env=', () => {
  const repo = makeRepo();
  const r = deploy(repo, 'apps/backend', ['--print']);
  assert.ok(r.stdout.split('\n').includes('--env='));
});

// ---- 审查后补的（2026-10-07）----

test('同一提交先绿后红：最近一次说了算，警告', () => {
  const repo = makeRepo();
  writeFileSync(repo.verdictsFile, [line({ head: repo.head }), line({ head: repo.head, verdict: 'red' })].join('\n') + '\n');
  const r = deploy(repo, 'apps/backend');
  assert.ok(r.warned);
  assert.ok(r.wranglerCalled);
});

test('同一提交先红后绿：不警告', () => {
  const repo = makeRepo();
  writeFileSync(repo.verdictsFile, [line({ head: repo.head, verdict: 'red' }), line({ head: repo.head })].join('\n') + '\n');
  assert.ok(!deploy(repo, 'apps/backend').warned);
});

test('显式传空环境（--env "" 与 --env=）仍是部署生产：照样查，不重复追加 --env=', () => {
  for (const args of [['--env', ''], ['--env=']]) {
    const repo = makeRepo();
    const r = deploy(repo, 'apps/backend', args);
    assert.ok(r.warned, args.join(' '));
    assert.ok(r.wranglerCalled);
    assert.equal(r.calls.filter((c) => c === '--env=').length, args.includes('--env=') ? 1 : 0);
  }
});
