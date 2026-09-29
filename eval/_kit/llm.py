"""原型与 eval 共用的 LLM 客户端：Workers AI（经本地 ai-worker）与本地 codex 判官。

为什么集中在这里：每个原型各写一份客户端，缓存、重试、复读检测、并发各不相同，
2026-09 的线索归并原型里并发被随手压到 4，全量跑一遍要十几分钟（实测 16 并发吞吐是 4 并发的 4 倍）。

前置：
- Workers AI：`cd services/meridian-ai-worker && pnpm wrangler dev --port 8787`（走 /meridian/chat 透传口，不写生产 R2）
- codex：本机装了 `codex` CLI（`codex exec`，只读沙箱）
"""
import hashlib, json, os, re, subprocess, tempfile, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

AI_WORKER_URL = os.environ.get('AI_WORKER_URL', 'http://localhost:8787/meridian/chat')
DEFAULT_MODEL = '@cf/zai-org/glm-4.7-flash'
# 2026-09-29 实测（短输出、48 次）：并发 4 → 5/s，16 → 19/s，32 → 26/s，零失败。长输出另测。
DEFAULT_CONCURRENCY = 16


def parse_json(text):
    """从模型输出里抠出第一个 JSON 对象或数组（容忍 ``` 围栏和前后废话）。"""
    t = re.sub(r'^```(?:json)?|```$', '', text.strip(), flags=re.M).strip()
    m = re.search(r'[\[{].*[\]}]', t, flags=re.S)
    if not m:
        raise ValueError(f'输出里没有 JSON：{text[:120]!r}')
    return json.loads(m.group(0))


def repetitive(text):
    """代码侧复读检测：同一 20 字片段出现 ≥5 次（只查 >400 字）。JSON 列表天然重复，别对解析成功的输出用。"""
    if len(text) <= 400:
        return False
    segs = [text[i:i + 20] for i in range(0, len(text) - 20, 10)]
    return any(segs.count(s) >= 5 for s in set(segs))


class _Cache:
    def __init__(self, path):
        self.path, self.lock, self.data = path, threading.Lock(), {}
        if path and os.path.exists(path):
            for line in open(path):
                r = json.loads(line)
                self.data[r['key']] = r['text']

    def get(self, key):
        return self.data.get(key)

    def put(self, key, text):
        with self.lock:
            self.data[key] = text
            if self.path:
                os.makedirs(os.path.dirname(self.path), exist_ok=True)
                with open(self.path, 'a') as f:
                    f.write(json.dumps({'key': key, 'text': text}, ensure_ascii=False) + '\n')


class WorkersAI:
    """Workers AI 聊天。按 (prompt, 参数, 模型) 缓存；网络错 / 解析失败 / 截断时重试，最多 4 次。

    用法：
        llm = WorkersAI(cache_dir='out/my-probe')                 # 产物目录下落 llm-cache.jsonl
        obj = llm('只输出 JSON …', max_tokens=300)                 # 返回解析后的 JSON
        outs = llm.map(prompts, max_tokens=300)                     # 并发跑一批，保持顺序；失败的位置是异常对象
    """

    def __init__(self, cache_dir=None, model=DEFAULT_MODEL, concurrency=DEFAULT_CONCURRENCY):
        self.model, self.concurrency = model, concurrency
        self.cache = _Cache(os.path.join(cache_dir, 'llm-cache.jsonl') if cache_dir else None)
        self.log_path = os.path.join(cache_dir, 'llm-calls.jsonl') if cache_dir else None
        self.lock = threading.Lock()
        self.requests = 0   # 发起的调用数（含缓存命中）= 生产上每次都要花的钱
        self.calls = 0      # 真正打到模型的次数

    def __call__(self, prompt, max_tokens=800, temperature=0, parse=True):
        key = hashlib.sha256(json.dumps([prompt, max_tokens, temperature, self.model]).encode()).hexdigest()
        with self.lock:
            self.requests += 1
        hit = self.cache.get(key)
        if hit is not None:
            return parse_json(hit) if parse else hit
        last = None
        for attempt in range(4):
            try:
                text, finish = self._post(prompt, max_tokens, temperature)
                with self.lock:
                    self.calls += 1
                    if self.log_path:
                        with open(self.log_path, 'a') as f:
                            f.write(json.dumps({'key': key, 'attempt': attempt, 'finish': finish, 'model': self.model,
                                                'prompt': prompt, 'text': text}, ensure_ascii=False) + '\n')
                if finish == 'length':
                    raise ValueError('截断（可能是复读）' if repetitive(text) else '截断')
                if parse:
                    out = parse_json(text)
                elif repetitive(text):
                    raise ValueError('复读')
                else:
                    out = text
                self.cache.put(key, text)
                return out
            except Exception as e:  # noqa: BLE001 — 网络错/解析失败/复读/截断都重试
                last = e
                time.sleep(1 + attempt)
        raise RuntimeError(f'{self.model} 调用 4 次失败：{last}')

    def map(self, prompts, **kw):
        def one(p):
            try:
                return self(p, **kw)
            except Exception as e:  # noqa: BLE001
                return e
        with ThreadPoolExecutor(self.concurrency) as ex:
            return list(ex.map(one, prompts))

    def _post(self, prompt, max_tokens, temperature):
        body = json.dumps({'messages': [{'role': 'user', 'content': prompt}],
                           'options': {'model': self.model, 'temperature': temperature, 'max_tokens': max_tokens}}).encode()
        req = urllib.request.Request(AI_WORKER_URL, data=body, headers={'content-type': 'application/json'})
        with urllib.request.urlopen(req, timeout=180) as r:
            d = json.loads(r.read())
        if not d.get('success'):
            raise RuntimeError(json.dumps(d, ensure_ascii=False)[:300])
        ch = d['data']['choices'][0]
        # 关 thinking 后正文落哪个字段各家不同（glm 在 content，qwen3 在 reasoning_content）
        msg = ch['message']
        return msg.get('content') or msg.get('reasoning_content') or '', ch.get('finish_reason')


class Codex:
    """本地 codex CLI 当判官（开发期用，生产不可用）。只读沙箱、非交互、用 JSON schema 约束输出。

    一次调用会起一个完整 agent 会话，单次 20–80 秒。2026-09-29 实测并发 6 会连续超时，并发 2 稳定。
    模型用 ~/.codex/config.toml 的默认值（传 model= 覆盖），结果里记下实际用的是谁。
    """

    def __init__(self, cache_dir=None, model=None, concurrency=2, timeout=180):
        self.model, self.concurrency, self.timeout = model, concurrency, timeout
        self.cache = _Cache(os.path.join(cache_dir, 'codex-cache.jsonl') if cache_dir else None)
        self.calls = 0

    def __call__(self, prompt, schema):
        key = hashlib.sha256(json.dumps([prompt, schema, self.model]).encode()).hexdigest()
        hit = self.cache.get(key)
        if hit is not None:
            return json.loads(hit)
        with tempfile.TemporaryDirectory() as tmp:
            sp, op = os.path.join(tmp, 'schema.json'), os.path.join(tmp, 'out.json')
            json.dump(schema, open(sp, 'w'))
            cmd = ['codex', 'exec', '-s', 'read-only', '--skip-git-repo-check', '-C', tmp,
                   '--output-schema', sp, '-o', op]
            if self.model:
                cmd += ['-m', self.model]
            last = None
            for _ in range(2):
                try:
                    subprocess.run(cmd, input=prompt, text=True, capture_output=True, timeout=self.timeout, check=True)
                    text = open(op).read()
                    out = json.loads(text)
                    self.calls += 1
                    self.cache.put(key, text)
                    return out
                except Exception as e:  # noqa: BLE001
                    last = e
            raise RuntimeError(f'codex 调用失败：{last}')

    def map(self, prompts, schema):
        def one(p):
            try:
                return self(p, schema)
            except Exception as e:  # noqa: BLE001
                return e
        with ThreadPoolExecutor(self.concurrency) as ex:
            return list(ex.map(one, prompts))
