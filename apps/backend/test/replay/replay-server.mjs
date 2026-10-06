// 录像库与 runner 的本地 HTTP 服务：模型 provider 边界上的请求都落到这里，按录像作答。
// 从 replay.mjs 拆出来是为了能单独测（replay-server.test.mjs）；replay.mjs 一 import 就开跑。
//
// 三类请求、两个入口：
//   POST /run                         替身 worker 转来的 `env.AI.run(model, inputs)`：chat（inputs.messages）按录像作答；
//                                     向量（inputs.text）不在录像里，由本地向量缓存作答（vector-cache.mjs）
//   POST /dashscope/chat/completions  ai-worker 的 DashScope 通道（DASHSCOPE_BASE_URL 指到 /dashscope）
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { requestKey, renderRequest, unifiedDiff, similarity } from './lib.mjs';

/** 一条录像走的是哪条通道。老录像没有 dashscope 这个值，全是 workers-ai。 */
const channelOf = (rec) => (rec.request.provider === 'dashscope' ? 'dashscope' : 'workers-ai');

// ── 录像库 ────────────────────────────────────────────────────────────────
export class ReplayStore {
  /** @param recDir 录像目录；@param outDir miss 的 diff 落在哪 */
  constructor(recDir, outDir) {
    this.outDir = outDir;
    this.records = fs.readdirSync(recDir).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(recDir, f), 'utf8')))
      .sort((a, b) => a.phase.localeCompare(b.phase) || a.call_index - b.call_index);
    // 能按录像作答的请求：每条 chat 录像一条
    this.entries = [];
    this.queues = new Map();
    // 向量调用的录像只有条数（生产不存文本和向量），没法拿来作答或比对，只记下生产发了几批
    this.embedBatchesRecorded = 0;
    for (const r of this.records) {
      if (r.error || !r.response) throw new Error(`录像 ${r.phase}-${r.call_index} 是失败调用（error=${r.error}），重放器暂不支持`);
      if (!Array.isArray(r.request.messages)) {
        this.embedBatchesRecorded += r.request.batches ?? 0;
        continue;
      }
      const e = this.entryOf(r);
      this.entries.push(e);
      if (!this.queues.has(e.key)) this.queues.set(e.key, []);
      this.queues.get(e.key).push(e);
    }
    this.served = [];
    this.misses = [];
    this.missSigs = new Set();
    this.used = new Set();
  }

  entryOf(r) {
    const id = `${r.phase}-${r.call_index}`;
    const model = r.request.model;
    return {
      id, key: `${channelOf(r)}:${requestKey(model, r.request)}`,
      render: () => renderRequest(model, r.request),
      // 形状对齐 glm-4.7-flash 经 env.AI binding 的返回（OpenAI 兼容、无 result 外壳、
      // 关思维链后正文在 content）。ai-worker 的 capabilities/chat.ts 从这里解析。
      // DashScope 的兼容接口也是这个形状（services/dashscope.ts 只读 content / finish_reason / usage）。
      reply: {
        id: `replay-${id}`,
        object: 'chat.completion',
        created: 0,
        model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: r.response.content, reasoning_content: null, tool_calls: [] },
          finish_reason: r.response.finish_reason,
        }],
        usage: r.response.usage,
      },
    };
  }

  /** 逐句核查的模式随录像走：录像里有一次调用核查的调用就是 one_call，否则（这次改动之前的录像）是 agent。 */
  get checkMode() {
    return this.records.some((r) => r.phase === 'brief_block_v6_check_one_call') ? 'one_call' : 'agent';
  }

  /** @param channel 请求从哪条通道来：'workers-ai'（binding）或 'dashscope'。通道不同的录像不拿来作答。 */
  answer(channel, model, inputs) {
    const k = `${channel}:${requestKey(model, inputs)}`;
    const q = this.queues.get(k);
    const e = q?.find((x) => !this.used.has(x)) ?? null;
    if (e) {
      this.used.add(e);
      this.served.push(e.id);
      return e.reply;
    }
    // 同一请求被打了比录像更多次（录像同 key 已用完）也算 miss：生产没发过第二次。
    return this.miss(renderRequest(model, inputs), q ? '同一请求的录像已用完（本地比生产多发了一次）' : `录像里没有这条请求（通道 ${channel}）`);
  }

  miss(actual, why) {
    let best = null;
    let bestScore = -1;
    let bestText = '';
    for (const e of this.entries) {
      const text = e.render();
      const s = similarity(text, actual);
      if (s > bestScore) { bestScore = s; best = e; bestText = text; }
    }
    const n = this.misses.length + 1;
    const closest = best ? best.id : null;
    const diff = best ? unifiedDiff(bestText, actual, `recorded ${closest}`, 'replay request') : actual;
    const file = path.join(this.outDir, `miss-${n}.diff`);
    fs.writeFileSync(file, `# ${why}\n# 最接近的录像: ${closest ?? '无'}（相似度 ${bestScore.toFixed(3)}）\n\n${diff}`);
    // ai-worker 与 workflow 各自有重试，同一处改动会连带几十次 miss；diff 去掉 @@ 行号后
    // 相同的只在终端打一次，免得刷屏（每次仍各落一个文件）。
    const sig = diff.split('\n').filter((l) => /^[-+][^-+]/.test(l)).join('\n');
    const first = !this.missSigs.has(sig);
    this.missSigs.add(sig);
    this.misses.push({ n, why, closest, file, first });
    if (first) {
      console.error(`\n[replay] ✗ MISS #${n}: ${why}；最接近 ${closest ?? '无'}。diff → ${file}`);
      console.error(diff.split('\n').slice(0, 40).join('\n'));
    }
    return null;
  }

  unused() {
    return this.entries.filter((e) => !this.used.has(e)).map((e) => e.id);
  }
}

const DASHSCOPE_PATH = '/dashscope';

/** @param vectors 向量缓存（VectorCache）；不给时向量调用一律报错 */
export function startReplayServer(store, port, vectors) {
  const server = http.createServer((req, res) => {
    let body = '';
    // 必须按流解码：逐块 `body += buffer` 会把跨块的多字节字符（如 ”）解成 ��，
    // 造成偶发 replay miss（2026-09-24 实测 5 次里 2 次，都落在同一篇文章的同一个字符上）
    req.setEncoding('utf8');
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        if (req.url === `${DASHSCOPE_PATH}/chat/completions`) {
          // ai-worker 的 DashScope 通道直接打过来的：请求体就是发给厂商的 model / messages / temperature / max_tokens
          const sent = JSON.parse(body);
          const out = store.answer('dashscope', sent.model, sent);
          // miss 回 400：通道把它当「重发也没用」的厂商报错，不等待重发；不能回 401/403——那会被当成 key 无效，
          // 这一块之后的核查就都不走 DashScope 了。miss 已记在录像库里，runner 据此判 FAIL。
          res.writeHead(out ? 200 : 400, { 'content-type': 'application/json' });
          res.end(JSON.stringify(out ?? { error: { message: 'replay miss (see runner output)', type: 'replay_miss', code: 'replay_miss' } }));
          return;
        }
        const { model, inputs } = JSON.parse(body);
        if (Array.isArray(inputs.text)) {
          if (!vectors) throw new Error('重放服务没配向量缓存，答不了向量调用');
          // bge-m3 经 binding 的返回里 embed-texts.ts 只读 data（与可选的 usage，不回）
          const data = await vectors.get(model, inputs.text);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ shape: [data.length, data[0]?.length ?? 0], data }));
          return;
        }
        const out = store.answer('workers-ai', model, inputs);
        if (!out) { res.writeHead(599); res.end('replay miss (see runner output)'); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500); res.end(String(e));
      }
    });
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

/**
 * 重放时 ai-worker 的变量：核查模式随录像走；DashScope 的地址指到上面的本地服务，key 是占位值
 * （通道见不到 key 会在发请求之前就拒绝，所以必须给一个；它只会被发到本机）。
 */
export function aiWorkerReplayEnv(store, replayPort) {
  return {
    vars: { BRIEF_CHECK_MODE: store.checkMode, DASHSCOPE_BASE_URL: `http://127.0.0.1:${replayPort}${DASHSCOPE_PATH}` },
    devVars: { DASHSCOPE_API_KEY: 'replay-not-a-real-key' },
  };
}
