// 隔离检查的对外行为：跑脚本、看退出码与输出。反例在临时目录里改仓库现状的配置副本。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/check-staging-isolation.mjs');
const BACKEND = path.join(ROOT, 'apps/backend/wrangler.jsonc');
const AI = path.join(ROOT, 'services/meridian-ai-worker/wrangler.toml');

function run(backendText, aiText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-'));
  const b = path.join(dir, 'wrangler.jsonc');
  const a = path.join(dir, 'wrangler.toml');
  fs.writeFileSync(b, backendText ?? fs.readFileSync(BACKEND, 'utf8'));
  fs.writeFileSync(a, aiText ?? fs.readFileSync(AI, 'utf8'));
  const r = spawnSync('node', [SCRIPT, '--backend', b, '--ai-worker', a], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status, out: r.stdout + r.stderr };
}
const read = (p) => fs.readFileSync(p, 'utf8');

test('仓库现状通过', () => {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('staging 抄了生产 bucket：报错并点名', () => {
  const r = run(read(BACKEND).replace('meridian-articles-staging', 'meridian-articles-prod'));
  assert.equal(r.code, 1);
  assert.match(r.out, /meridian-articles-prod/);
  assert.match(r.out, /bucket/i);
});

test('ai-worker staging 抄了生产 bucket', () => {
  const r = run(null, read(AI).replace('meridian-articles-staging', 'meridian-articles-prod'));
  assert.equal(r.code, 1);
  assert.match(r.out, /meridian-articles-prod/);
});

test('staging 抄了生产 Hyperdrive', () => {
  const r = run(read(BACKEND).replace('c2de49c847a54a6b8d390411f6359173', '7e8763d05a974473a3d371f7544593ce'));
  assert.equal(r.code, 1);
  assert.match(r.out, /hyperdrive/i);
  assert.match(r.out, /7e8763d05a974473a3d371f7544593ce/);
});

test('staging 抄了生产队列与 DLQ', () => {
  const r = run(
    read(BACKEND)
      .replaceAll('meridian-article-processing-queue-staging', 'meridian-article-processing-queue-prod')
      .replace('meridian-article-processing-dlq-staging', 'meridian-article-processing-dlq'),
  );
  assert.equal(r.code, 1);
  assert.match(r.out, /meridian-article-processing-queue-prod/);
  assert.match(r.out, /dlq/i);
});

test('staging 抄了生产 workflow 名与 service 名', () => {
  const r = run(
    read(BACKEND)
      .replace('auto_brief_generation_staging', 'auto_brief_generation')
      .replace('meridian-ai-worker-staging', 'meridian-ai-worker'),
  );
  assert.equal(r.code, 1);
  assert.match(r.out, /auto_brief_generation/);
  assert.match(r.out, /meridian-ai-worker/);
});

test('ML_SERVICE 共用生产不报错（白名单）', () => {
  const r = run();
  assert.equal(r.code, 0, r.out);
});

test('staging 带 cron', () => {
  const r = run(read(BACKEND).replace('"triggers": { "crons": [] }', '"triggers": { "crons": ["0 13 * * *"] }'));
  assert.equal(r.code, 1);
  assert.match(r.out, /cron/i);
});

test('staging 没写 triggers.crons', () => {
  const r = run(read(BACKEND).replace('"triggers": { "crons": [] },', ''));
  assert.equal(r.code, 1);
  assert.match(r.out, /cron/i);
});

test('ENVIRONMENT 写反（backend）', () => {
  const r = run(read(BACKEND).replace('"ENVIRONMENT": "staging"', '"ENVIRONMENT": "production"'));
  assert.equal(r.code, 1);
  assert.match(r.out, /ENVIRONMENT/);
});

test('ENVIRONMENT 写反（ai-worker 顶层）', () => {
  const r = run(null, read(AI).replace('ENVIRONMENT = "production"', 'ENVIRONMENT = "staging"'));
  assert.equal(r.code, 1);
  assert.match(r.out, /ENVIRONMENT/);
});

test('ai-worker staging 的 DASHSCOPE_BASE_URL 与生产相同', () => {
  const r = run(null, read(AI).replace('/meridian-ai/custom-dashscope', '/meridian-gateway/custom-dashscope'));
  assert.equal(r.code, 1);
  assert.match(r.out, /DASHSCOPE_BASE_URL/);
});

test('漏了 staging 段', () => {
  const b = run(read(BACKEND).replace('"env": {', '"envx": {'));
  assert.equal(b.code, 1);
  assert.match(b.out, /staging/);
  const text = read(AI);
  const a = run(null, text.slice(0, text.indexOf('# ---------- Staging')));
  assert.equal(a.code, 1);
  assert.match(a.out, /staging/);
});
