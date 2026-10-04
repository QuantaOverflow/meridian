# eval/_kit —— 原型与 eval 共用工具

原型各写一套取数据、调模型、打分的代码，慢且口径不一（2026-09 事件追踪那轮：模型并发被随手压到 4，
R2 串行拉取卡了 2.5 小时，每个原型各有一份评测脚本）。新原型直接用这里的，只写自己的那部分逻辑。

Python，无第三方依赖。用法：`sys.path.insert(0, '<仓库>/eval/_kit')` 后 `import data, llm, threads`。
本地缓存落 `eval/_kit/.cache/`（被 `eval/.gitignore` 挡）。

## 开跑前

| 要用什么 | 先做什么 |
|---|---|
| Workers AI（`llm.WorkersAI`） | `cd services/meridian-ai-worker && pnpm wrangler dev --port 8787` |
| codex 判官（`llm.Codex`） | 本机有 `codex` CLI |
| 生产库（`data.fetch_centroids` / `dump_published_stories`） | 环境变量 `DATABASE_URL`（Neon 连接串，只放环境变量，不写文件） |
| R2 正文（`data.fetch_r2_texts`） | `npx wrangler login` |

## 模型白名单（`models.json`）

开发调试能用哪些 Workers AI 模型、各在哪一档，写在 `models.json`（2026-10-04 定，依据 Cloudflare 模型目录、定价页和我们的实测）。
`llm.WorkersAI(backend='rest')` 构造时调 `check_model()` 检查：`blocked` 拒绝；`core` 档（贵，只给核心节点）要 `ALLOW_CORE=1`；
名单外的模型要 `ALLOW_UNLISTED=1`，只用于资格测试。原型 `writer-faithfulness/lib.mts` 读同一份文件、做同样的检查。
付费模型（`rpm: 20`）每账号每模型限 20 次/分钟（报错 3021），同一模型上并行开多个实验不会更快。
新模型过了资格测试再写进来，`measured` 写清在哪份数据上测的什么。

## 模块

- `llm.py`
  - `WorkersAI(cache_dir, model, concurrency=16, backend='local')`：按 prompt 缓存、重试、截断/复读检测；`.map()` 并发跑一批。
    实测（2026-09-29，短输出）：并发 4 → 5 次/秒，16 → 19 次/秒，32 → 26 次/秒，零失败。
    `backend='local'` 经本地 ai-worker，只放行生产白名单模型（glm-4.7-flash、qwen3-30b）；
    `backend='rest'` 直连 Workers AI REST，可试其他模型（可用：gpt-oss-120b、llama-3.3-70b-instruct-fp8-fast），
    需要环境变量 `CF_ACCOUNT_ID`、`CF_API_TOKEN`（从两个 `.dev.vars` 读进环境，别写文件）。REST 并发 8 实测正常。
  - `Codex(cache_dir, model=None, concurrency=2)`：本地 `codex exec` 只读沙箱 + JSON schema。单次 20–80 秒；并发 6 会连续超时。开发期判官，生产不可用。
- `data.py`
  - `load_gold(set_id)` / `load_evidence(set_id)`：读 `eval/_data/<set>/` 的标签与证据快照。
  - `fetch_centroids(story_ids)`：批量取故事向量（一次查询，缓存）。
  - `dump_published_stories(out, where)`：导出一批期的入选故事快照（新数据当考卷用）。
  - `fetch_r2_texts(keys, parallel=16)`：并发拉 R2 对象，已缓存的跳过。单个 10–16 秒，**调用方要给总时长设上限**。
- `threads.py`（事件追踪线索归并）
  - `score(pred, gold, split)`：B³ 精确 / 召回 / F1 + 读者可见的「拆开几条、串进几条」。
  - `bootstrap_delta(pred_a, pred_b, gold, split)`：按期重采样的差值与 95% 区间、噪声底。
  - `centroid_baseline(stories, vectors, tau=0.94)`：生产算法复刻，与生产逐条一致——任何新方案先跟它比。
  - `same_line_prompt(a, b)` + `SAME_LINE_SCHEMA`：「两故事该不该同线」判官 prompt，与 2026-09-29 探测逐字相同。

## 现成的数据集（`eval/_data/`）

| set | 用途 | 状态 |
|---|---|---|
| `story-threads-v1` | 事件追踪归并，888 故事，dev（1–19 期）/ holdout（20–38 期） | dev 已耗尽；holdout 看过错例 |
| `story-threads-exam-v1` | 同上的考卷，148 故事（5–7 月旧期） | 用过一次 |
| `story-thread-pairs-v1` | 判官：56 对门槛分不开的难例 | 用过一次（codex / glm） |

**都已不干净**。下一轮要干净的考卷：`data.dump_published_stories(..., where="r.published_at > '2026-09-29'")`
取新期，开考前标金标、请用户对齐边界，再让任何方案跑。

## 例子

```python
import sys; sys.path.insert(0, 'eval/_kit')
import data, llm, threads

gold = data.load_gold('story-threads-exam-v1')
vecs = data.fetch_centroids(gold)                                    # 需要 DATABASE_URL
stories = [{'story_id': s, 'period': g['period']} for s, g in gold.items()]
base = threads.centroid_baseline(stories, vecs, tau=0.94)
print(threads.score(base, gold, 'exam'))

judge = llm.WorkersAI(cache_dir='out/my-probe', model='@cf/openai/gpt-oss-120b')
```
