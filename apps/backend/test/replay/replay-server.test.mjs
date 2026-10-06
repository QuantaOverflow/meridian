// 重放器「按录像作答」这一段的测试：从 runner 的本地 HTTP 服务进（替身 worker 与 ai-worker 的 DashScope 通道
// 打的就是它），录像用 fixtures/ 下手写的小样本。不起 wrangler、不连任何外部服务：现算向量要调的
// Cloudflare REST API 由本文件起的 node:http 服务假冒。
// 跑法：pnpm -F @meridian/backend test:replay（node --test；backend 的 vitest 跑在 workerd 里，起不了 node:http 服务）
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { HERE, requestKey } from './lib.mjs';
import { ReplayStore, startReplayServer, aiWorkerReplayEnv } from './replay-server.mjs';
import { VectorCache } from './vector-cache.mjs';

const fixture = (name) => path.join(HERE, 'fixtures', name, 'recording');
const record = (name, file) => JSON.parse(fs.readFileSync(path.join(fixture(name), file), 'utf8'));
const BGE = '@cf/baai/bge-m3';

let outDir;
const servers = [];
before(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
});
after(() => {
  for (const s of servers) s.close();
  fs.rmSync(outDir, { recursive: true, force: true });
});

/** 起一个 runner 服务；返回录像库、ai-worker 会拿到的配置、以及两条通道各自的发请求函数。 */
async function start(name, vectors) {
  const store = new ReplayStore(fixture(name), fs.mkdtempSync(path.join(outDir, `${name}-`)));
  const server = await startReplayServer(store, 0, vectors);
  servers.push(server);
  const port = server.address().port;
  const env = aiWorkerReplayEnv(store, port);
  const post = (url, body, headers = {}) => fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return {
    store, env,
    // 替身 worker（replay-ai-worker.js）转来的 binding 调用
    binding: (model, inputs) => post(`http://127.0.0.1:${port}/run`, { model, inputs, options: null }),
    // ai-worker 的 DashScope 通道：地址与 key 取自生成的配置，请求体同 services/dashscope.ts 发的
    dashscope: (req) => post(`${env.vars.DASHSCOPE_BASE_URL}/chat/completions`, { ...req, enable_thinking: false }, {
      Authorization: `Bearer ${env.devVars.DASHSCOPE_API_KEY}`, 'cf-aig-skip-cache': 'true',
    }),
  };
}
const chatRequest = (rec) => ({ messages: rec.request.messages, temperature: rec.request.temperature, max_tokens: rec.request.max_tokens });
const lastMiss = (store) => fs.readFileSync(store.misses.at(-1).file, 'utf8');
/** 把一条 user 消息里的一个词换掉 */
const reword = (messages, from, to) => messages.map((m) => (m.role === 'user' ? { ...m, content: m.content.replace(from, to) } : m));

describe('这次改动之前的录像（agent 模式）', () => {
  const rec = record('agent', 'brief_block_v6-000.json');

  it('已有 chat 调用的 key 不变', () => {
    // 期望值是改动前的 requestKey 在这条 fixture 上算出来的
    assert.equal(requestKey(rec.request.model, rec.request), 'fe7268968bdfa05e3b4f5654ed8698111ee53ce51218d9dc549e5edb90ce8b21');
  });

  it('没有一次调用核查的录像 → 模式 agent；binding 的 chat 调用照旧从录像作答', async () => {
    const r = await start('agent');
    assert.equal(r.env.vars.BRIEF_CHECK_MODE, 'agent');
    const res = await r.binding(rec.request.model, chatRequest(rec));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.choices[0].message.content, 'The harbour reopened on Monday [1:0].');
    assert.equal(body.choices[0].finish_reason, 'stop');
    assert.deepEqual(r.store.unused(), []);
    assert.equal(r.store.misses.length, 0);
  });
});

describe('DashScope 的 chat 调用', () => {
  const rec = record('one-call', 'brief_block_v6_check_one_call-000.json');

  it('生成的配置：地址指向 runner 的本地服务，key 是占位值，模式 one_call', async () => {
    const r = await start('one-call');
    assert.match(r.env.vars.DASHSCOPE_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\//);
    assert.equal(r.env.devVars.DASHSCOPE_API_KEY, 'replay-not-a-real-key');
    assert.equal(r.env.vars.BRIEF_CHECK_MODE, 'one_call');
  });

  it('从录像作答：OpenAI 兼容的回包，正文、结束原因、用量取自录像', async () => {
    const r = await start('one-call');
    const res = await r.dashscope({ model: 'qwen3.8-flash', ...chatRequest(rec) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.choices[0].message.content, 'CHECKS\n1. reopened on Monday: [1:0] says so.\nRESULT\n{"ok":true}');
    assert.equal(body.choices[0].finish_reason, 'stop');
    assert.equal(body.usage.prompt_tokens, 4200);
    assert.equal(body.usage.completion_tokens, 600);
    assert.deepEqual(r.store.served, ['brief_block_v6_check_one_call-0']);
  });

  it('证据包里改一个词 → miss：不是会重发也不是 key 无效的 4xx，diff 里看得到改了哪个词', async () => {
    const r = await start('one-call');
    const res = await r.dashscope({ model: 'qwen3.8-flash', ...chatRequest(rec), messages: reword(rec.request.messages, 'Two ferries', 'Three ferries') });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'replay_miss');
    assert.equal(r.store.misses.length, 1);
    assert.equal(r.store.misses[0].closest, 'brief_block_v6_check_one_call-0');
    const diff = lastMiss(r.store);
    assert.match(diff, /^-\[1:1\] Two ferries resumed service\.$/m);
    assert.match(diff, /^\+\[1:1\] Three ferries resumed service\.$/m);
  });

  it('同一请求比录像多发一次 → miss', async () => {
    const r = await start('one-call');
    const req = { model: 'qwen3.8-flash', ...chatRequest(rec) };
    assert.equal((await r.dashscope(req)).status, 200);
    assert.equal((await r.dashscope(req)).status, 400);
    assert.match(r.store.misses[0].why, /已用完/);
  });

  it('录的是 DashScope 的调用，本地却从 binding 发出去 → miss', async () => {
    const r = await start('one-call');
    const res = await r.binding('qwen3.8-flash', chatRequest(rec));
    assert.equal(res.status, 599);
    assert.equal(r.store.misses.length, 1);
  });
});

/** 假冒 Cloudflare REST API 的本地服务；requests 记下收到的每个请求。reply(texts) 给出 { status, body }。 */
async function fakeCloudflare(reply) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const sent = JSON.parse(body);
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: sent });
      const out = reply(sent.text);
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { apiBase: `http://127.0.0.1:${server.address().port}/client/v4`, requests };
}

describe('向量调用：本地缓存，没有的现算', () => {
  // 手写的假向量：每句一条，REST 回包的形状同 Workers AI 的 bge-m3
  const VECTORS = {
    'The harbour reopened on Monday.': [0.25, -0.5, 0.125],
    'Two ferries resumed service.': [0.0625, 0.75, -0.375],
    'Three ferries resumed service.': [-0.875, 0.03125, 0.5],
  };
  const ok = (texts) => ({ status: 200, body: { success: true, errors: [], result: { shape: [texts.length, 3], data: texts.map((t) => VECTORS[t]), pooling: 'cls' } } });
  const BATCH = ['The harbour reopened on Monday.', 'Two ferries resumed service.'];
  const cacheDir = () => fs.mkdtempSync(path.join(outDir, 'vectors-'));
  const cache = (dir, cf, token = 'test-token') => new VectorCache(dir, { apiBase: cf.apiBase, accountId: 'acct-test', token });

  it('缓存里没有 → 调一次真模型的 REST 接口，按回包作答', async () => {
    const cf = await fakeCloudflare(ok);
    const vectors = cache(cacheDir(), cf);
    const r = await start('one-call', vectors);
    const res = await r.binding(BGE, { text: BATCH });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, [[0.25, -0.5, 0.125], [0.0625, 0.75, -0.375]]);
    assert.deepEqual(cf.requests, [{
      method: 'POST',
      url: '/client/v4/accounts/acct-test/ai/run/@cf/baai/bge-m3',
      authorization: 'Bearer test-token',
      body: { text: BATCH },
    }]);
    assert.match(vectors.summary(), /缓存作答 0 批.*现算 1 批/);
  });

  it('算过的批次下一次重放从缓存作答，不再调 REST；句子换一个词或换顺序是另一批', async () => {
    const dir = cacheDir();
    const first = await fakeCloudflare(ok);
    await (await start('one-call', cache(dir, first))).binding(BGE, { text: BATCH });

    // 第二次重放：新的进程状态（新的 VectorCache），同一个目录
    const cf = await fakeCloudflare(ok);
    const vectors = cache(dir, cf);
    const r = await start('one-call', vectors);
    const again = await r.binding(BGE, { text: BATCH });
    assert.deepEqual((await again.json()).data, [[0.25, -0.5, 0.125], [0.0625, 0.75, -0.375]]);
    assert.equal(cf.requests.length, 0);

    const reworded = await r.binding(BGE, { text: ['The harbour reopened on Monday.', 'Three ferries resumed service.'] });
    assert.deepEqual((await reworded.json()).data, [[0.25, -0.5, 0.125], [-0.875, 0.03125, 0.5]]);
    const reordered = await r.binding(BGE, { text: [...BATCH].reverse() });
    assert.deepEqual((await reordered.json()).data, [[0.0625, 0.75, -0.375], [0.25, -0.5, 0.125]]);
    assert.equal(cf.requests.length, 2);
    assert.match(vectors.summary(), /缓存作答 1 批.*现算 2 批/);
  });

  it('缓存里没有又没有凭据 → 不发请求，报错说清楚要设什么', async () => {
    const cf = await fakeCloudflare(ok);
    const vectors = cache(cacheDir(), cf, '');
    const r = await start('one-call', vectors);
    const res = await r.binding(BGE, { text: BATCH });
    assert.equal(res.status, 500);
    assert.match(await res.text(), /CLOUDFLARE_API_TOKEN/);
    assert.equal(cf.requests.length, 0);
    assert.equal(vectors.failures.length, 1);
    assert.match(vectors.failures[0], /CLOUDFLARE_API_TOKEN.*Workers AI/s);
  });

  it('REST 拒绝（token 没有 Workers AI 权限）或回的条数不对 → 报错，不落缓存', async () => {
    const dir = cacheDir();
    const denied = await fakeCloudflare(() => ({ status: 403, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }], result: null } }));
    const r1 = await start('one-call', cache(dir, denied));
    const res1 = await r1.binding(BGE, { text: BATCH });
    assert.equal(res1.status, 500);
    assert.match(await res1.text(), /HTTP 403.*Authentication error.*Workers AI/s);

    const short = await fakeCloudflare(() => ({ status: 200, body: { success: true, result: { data: [[0.25, -0.5, 0.125]] } } }));
    const r2 = await start('one-call', cache(dir, short));
    const res2 = await r2.binding(BGE, { text: BATCH });
    assert.equal(res2.status, 500);
    assert.match(await res2.text(), /要 2 条，回 1/);

    // 两次都没留下东西：换成正常的服务后仍要现算
    const cf = await fakeCloudflare(ok);
    const r3 = await start('one-call', cache(dir, cf));
    assert.equal((await r3.binding(BGE, { text: BATCH })).status, 200);
    assert.equal(cf.requests.length, 1);
  });

  it('同一批同时来两次 → 只算一次', async () => {
    const cf = await fakeCloudflare(ok);
    const vectors = cache(cacheDir(), cf);
    const r = await start('one-call', vectors);
    const [a, b] = await Promise.all([r.binding(BGE, { text: BATCH }), r.binding(BGE, { text: BATCH })]);
    assert.deepEqual((await a.json()).data, (await b.json()).data);
    assert.equal(cf.requests.length, 1);
    assert.match(vectors.summary(), /缓存作答 1 批.*现算 1 批/);
  });

  it('录像里的向量记录只有条数没有文本：不算「没用到的录像」，记下生产发了几批', async () => {
    const r = await start('one-call');
    assert.deepEqual(r.store.unused(), ['brief_block_v6_check_one_call-0']);
    assert.equal(r.store.embedBatchesRecorded, 2);
  });
});
