// scripts/staging-run.mjs 的对外行为：对着本地假 backend 跑，一律 --no-reset。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'staging-run.mjs');
const TOKEN = 'test-token-xyz';
const DB_URL = 'postgres://user:secret-pass@host/db';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-run-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const SERVICES = [
  { service: 'backend', commit: '88ad3e0', dirty: false },
  { service: 'ai-worker', commit: '88ad3e0', dirty: true },
  { service: 'ml-service', commit: 'zzz', dirty: false },
];

// behavior: { trigger: {status, body}, runs: [{status, body}, ...]（最后一项重复） }
async function withBackend(behavior, fn) {
  const seen = { auth: [], triggers: 0, polls: 0 };
  const server = http.createServer((req, res) => {
    seen.auth.push(req.headers.authorization);
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && req.url === '/admin/briefs/run-scheduled') {
      seen.triggers++;
      return send(behavior.trigger.status, behavior.trigger.body);
    }
    if (req.url.startsWith('/observability/ops/runs/')) {
      const r = behavior.runs[Math.min(seen.polls++, behavior.runs.length - 1)];
      return send(r.status, r.body);
    }
    if (req.url === '/observability/ops/services') return send(200, SERVICES);
    send(404, {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, seen);
  } finally {
    server.close();
  }
}

function runScript(url, { env = {}, args = [] } = {}) {
  const verdicts = path.join(tmp, `v-${Math.random().toString(36).slice(2)}.jsonl`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, '--no-reset', '--poll-interval-ms', '20', ...args], {
      env: {
        PATH: process.env.PATH,
        STAGING_BACKEND_URL: url,
        STAGING_API_TOKEN: TOKEN,
        STAGING_DATABASE_URL: DB_URL,
        STAGING_READER_URL: 'https://reader.example',
        NEON_PROJECT_ID: 'proj-1',
        STAGING_VERDICTS_FILE: verdicts,
        STAGING_ENV_FILE: path.join(tmp, 'does-not-exist.env'),
        ...env,
      },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      const lines = fs.existsSync(verdicts)
        ? fs.readFileSync(verdicts, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];
      resolve({ code, out, lines });
    });
  });
}

const ID = 'cron-brief-abc';
const accepted = { status: 202, body: { success: true, data: { workflowId: ID } } };
const done = (flags, status = 'COMPLETED') => ({ status: 200, body: { run: { workflowId: ID, status, flags } } });

function assertRecord(line, verdict, flags) {
  assert.equal(line.workflowId, ID);
  assert.equal(line.verdict, verdict);
  assert.deepEqual(line.flags, flags);
  assert.ok(!Number.isNaN(Date.parse(line.at)));
  assert.deepEqual(line.services, {
    backend: { commit: '88ad3e0', dirty: false },
    'ai-worker': { commit: '88ad3e0', dirty: true },
  });
}

function assertNoSecrets(out) {
  assert.ok(!out.includes(TOKEN));
  assert.ok(!out.includes('secret-pass'));
}

test('红：failed -> 退出 1，记录 red', async () => {
  await withBackend({ trigger: accepted, runs: [done(['failed', 'late'], 'FAILED')] }, async (url, seen) => {
    const r = await runScript(url);
    assert.equal(r.code, 1);
    assert.equal(r.lines.length, 1);
    assertRecord(r.lines[0], 'red', ['failed', 'late']);
    assert.ok(r.out.includes(`https://reader.example/admin/runs/${ID}`));
    assert.ok(seen.auth.every((a) => a === `Bearer ${TOKEN}`));
    assertNoSecrets(r.out);
  });
});

test('红：no_stories -> 退出 1', async () => {
  await withBackend({ trigger: accepted, runs: [done(['no_stories'], 'TERMINATED_NO_STORIES')] }, async (url) => {
    const r = await runScript(url);
    assert.equal(r.code, 1);
    assertRecord(r.lines[0], 'red', ['no_stories']);
  });
});

test('黄：退出 0，打印黄的 flag，late 不算', async () => {
  await withBackend({ trigger: accepted, runs: [done(['degraded', 'late'], 'DEGRADED')] }, async (url) => {
    const r = await runScript(url);
    assert.equal(r.code, 0);
    assertRecord(r.lines[0], 'yellow', ['degraded', 'late']);
    assert.ok(r.out.includes('degraded'));
    assert.ok(r.out.includes(`https://reader.example/admin/runs/${ID}`));
  });
});

test('只有 late -> 绿', async () => {
  await withBackend({ trigger: accepted, runs: [done(['late'])] }, async (url) => {
    const r = await runScript(url);
    assert.equal(r.code, 0);
    assertRecord(r.lines[0], 'green', ['late']);
  });
});

test('绿：退出 0，打印读者页地址', async () => {
  await withBackend({ trigger: accepted, runs: [done([])] }, async (url) => {
    const r = await runScript(url);
    assert.equal(r.code, 0);
    assertRecord(r.lines[0], 'green', []);
    assert.ok(r.out.includes('https://reader.example'));
    assertNoSecrets(r.out);
  });
});

test('先 404 两次、RUNNING 一次再给终态 -> 正常', async () => {
  const running = { status: 200, body: { run: { workflowId: ID, status: 'RUNNING', flags: [] } } };
  await withBackend(
    { trigger: accepted, runs: [{ status: 404, body: {} }, { status: 404, body: {} }, running, done([])] },
    async (url, seen) => {
      const r = await runScript(url);
      assert.equal(r.code, 0);
      assert.equal(r.lines.length, 1);
      assert.equal(seen.polls, 4);
    },
  );
});

test('409：打印挡着的运行 id，退出 1，不写记录', async () => {
  const body = { success: false, error: 'busy', blockingWorkflowId: 'cron-brief-blocker' };
  await withBackend({ trigger: { status: 409, body }, runs: [done([])] }, async (url, seen) => {
    const r = await runScript(url);
    assert.equal(r.code, 1);
    assert.ok(r.out.includes('cron-brief-blocker'));
    assert.equal(r.lines.length, 0);
    assert.equal(seen.polls, 0);
  });
});

test('触发 500 -> 非零，不轮询', async () => {
  await withBackend({ trigger: { status: 500, body: { success: false } }, runs: [done([])] }, async (url, seen) => {
    const r = await runScript(url);
    assert.notEqual(r.code, 0);
    assert.equal(seen.polls, 0);
  });
});

test('一直 RUNNING -> 超时退出 3', async () => {
  const running = { status: 200, body: { run: { workflowId: ID, status: 'RUNNING', flags: [] } } };
  await withBackend({ trigger: accepted, runs: [running] }, async (url) => {
    const r = await runScript(url, { args: ['--timeout-min', '0.02'] });
    assert.equal(r.code, 3);
    assert.equal(r.lines.length, 0);
  });
});

test('缺配置 -> 退出 2 并点名缺哪个，不触发', async () => {
  await withBackend({ trigger: accepted, runs: [done([])] }, async (url, seen) => {
    const r = await runScript(url, { env: { STAGING_API_TOKEN: '' } });
    assert.equal(r.code, 2);
    assert.ok(r.out.includes('STAGING_API_TOKEN'));
    assert.equal(seen.triggers, 0);
  });
});

test('不认识的参数 -> 退出 2', async () => {
  const r = await runScript('http://127.0.0.1:1', { args: ['--bogus'] });
  assert.equal(r.code, 2);
});
