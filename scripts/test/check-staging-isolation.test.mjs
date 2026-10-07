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

// ---- 审查找出的漏网写法（2026-10-07）：手写解析器那一版每一种都退出 0；现在由 wrangler 读配置 ----

const AI_STG_BUCKET = 'bucket_name = "meridian-articles-staging"';

test('TOML 的各种写法抄生产 bucket 都认得出（单引号字符串、带引号的 key、带引号的表头）', () => {
  for (const bad of [
    read(AI).replace(AI_STG_BUCKET, "bucket_name = 'meridian-articles-prod'"),
    read(AI).replace(AI_STG_BUCKET, '"bucket_name" = "meridian-articles-prod"'),
    read(AI).replace('[[env.staging.r2_buckets]]', '[[env."staging".r2_buckets]]').replace(AI_STG_BUCKET, 'bucket_name = "meridian-articles-prod"'),
  ]) {
    const r = run(null, bad);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /R2 bucket/);
  }
});

test('ai-worker staging 用点分 key 写 cron', () => {
  const r = run(null, read(AI).replace('[env.staging.vars]', '[env.staging]\ntriggers.crons = ["0 13 * * *"]\n\n[env.staging.vars]'));
  assert.equal(r.code, 1);
  assert.match(r.out, /crons/);
});

test('ai-worker staging 带 cron', () => {
  const r = run(null, read(AI).replace('[env.staging.vars]', '[env.staging.triggers]\ncrons = ["0 13 * * *"]\n\n[env.staging.vars]'));
  assert.equal(r.code, 1);
  assert.match(r.out, /crons/);
});

test('把生产队列名填进 staging 的 DLQ，或把生产 DLQ 名填进 staging 的队列', () => {
  const a = run(read(BACKEND).replace('"dead_letter_queue": "meridian-article-processing-dlq-staging"', '"dead_letter_queue": "meridian-article-processing-queue-prod"'));
  assert.equal(a.code, 1);
  assert.match(a.out, /dead_letter_queue/);
  const b = run(read(BACKEND).replace('"producers": [{ "queue": "meridian-article-processing-queue-staging"', '"producers": [{ "queue": "meridian-article-processing-dlq"'));
  assert.equal(b.code, 1);
  assert.match(b.out, /meridian-article-processing-dlq/);
});

test('staging 段的 name 写成生产 worker 名', () => {
  const r = run(read(BACKEND).replace('"staging": {', '"staging": {\n      "name": "meridian-backend",'));
  assert.equal(r.code, 1);
  assert.match(r.out, /worker 名/);
});

test('staging 的 DO binding 用 script_name 指向生产脚本', () => {
  const r = run(read(BACKEND).replace('"bindings": [{ "class_name": "SourceScraperDO", "name": "SOURCE_SCRAPER" }]', '"bindings": [{ "class_name": "SourceScraperDO", "name": "SOURCE_SCRAPER", "script_name": "meridian-backend" }]'));
  assert.equal(r.code, 1);
  assert.match(r.out, /script_name/);
});

test('Hyperdrive id 抄生产值但换成大写', () => {
  const r = run(read(BACKEND).replace('c2de49c847a54a6b8d390411f6359173', '7E8763D05A974473A3D371F7544593CE'));
  assert.equal(r.code, 1);
  assert.match(r.out, /Hyperdrive/);
});

test('ML_SERVICE 这个 binding 指向别的生产 service：白名单不放行', () => {
  const r = run(read(BACKEND).replace('{ "binding": "ML_SERVICE", "service": "meridian-ml-service" },\n      ],\n    },', '{ "binding": "ML_SERVICE", "service": "meridian-ai-worker" },\n      ],\n    },'));
  assert.equal(r.code, 1);
  assert.match(r.out, /meridian-ai-worker/);
});

test('staging 的 DASHSCOPE_BASE_URL 是生产网关地址加尾斜杠，或同一个网关换了后半段', () => {
  const prod = read(AI).match(/^DASHSCOPE_BASE_URL = "([^"]+)"/m)[1];
  const stgLine = read(AI).match(/^DASHSCOPE_BASE_URL = "[^"]+meridian-ai\/[^"]+"/m)[0];
  for (const url of [prod + '/', prod.replace('/compatible-mode/v1', '/other')]) {
    const r = run(null, read(AI).replace(stgLine, `DASHSCOPE_BASE_URL = "${url}"`));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /DASHSCOPE_BASE_URL/);
  }
});

