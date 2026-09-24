# meridian-ml-service

Meridian 的 embedding 与聚类服务：Python / FastAPI，生产跑在 **Cloudflare Containers**
（`cf-worker/` 里的 Worker 把请求转发给容器）。唯一调用方是 `apps/backend`：

- `AutoBriefGenerationWorkflow` 聚类前批量补算缺失 embedding → `POST /embeddings`（客户端 `apps/backend/src/lib/services/ai-services.ts` 的 `generateEmbedding`）
- 随后聚类 → `POST /ai-worker/clustering`（客户端 `apps/backend/src/lib/services/clustering.ts`）

模型是 `intfloat/multilingual-e5-small`（384 维）。聚类现行算法是不降维的余弦距离凝聚聚类
（`agglomerative_cosine`，average linkage）；旧的 UMAP + HDBSCAN（`umap_hdbscan`）只作回滚路径保留。
算法选择与参数由 backend 的 `BRIEF_CLUSTERING_OPTIONS`（`apps/backend/src/lib/core/constants.ts`）随请求传入，
依据见 [`docs/adr/0003-cluster-as-brief-block.md`](../../docs/adr/0003-cluster-as-brief-block.md)。

## 路由（`src/main.py`）

除 `/health` 外都要求 `X-API-Token` 头等于 `API_TOKEN`（`src/dependencies.py` 的 `verify_token`）。

| 路由 | 请求 | 响应 |
|---|---|---|
| `GET /health` | — | `status`、`build_identity`、`embedding_model`、`clustering_available` |
| `POST /embeddings` | `{texts: string[], normalize?: bool, model_name?}` | `{embeddings, model_name, dimensions, processing_time}` |
| `POST /ai-worker/clustering` | `{items: [{id, embedding, title?, url?, …}], config?}`；`config` 字段见 `src/schemas.py` 的 `BaseClusteringConfig` | `clusters`（`cluster_id` = -1 为噪声）、`clustering_stats`、`config_used`、`build_identity` 等 |

`build_identity`（`build_sha` / `build_time` / `injected`）用来确认生产跑的是不是本次部署的镜像：
backend 在每次聚类时断言它（`clustering.ts` 的 `assertBuildIdentity`），缺字段即判定为旧镜像。
来历：2026-09-15 至 09-19 容器镜像没推上去，生产连续五天跑旧算法而 `brief_runs.status` 一直是 `COMPLETED`。

## 环境变量（`src/config.py`、`src/main.py`）

| 名称 | 默认 | 说明 |
|---|---|---|
| `API_TOKEN` 🔐 | 空 | 须与 backend 的 `MERIDIAN_ML_SERVICE_API_KEY` 一致；生产由 `cf-worker` 注入容器 |
| `EMBEDDING_MODEL_NAME` | `sentence-transformers/multilingual-e5-small` | 模型名或本地目录；镜像里设为 `/home/appuser/model` |
| `EXPECTED_EMBEDDING_DIMENSIONS` | `384` | |
| `BATCH_SIZE` | `32` | |
| `MERIDIAN_ML_BUILD_SHA`、`MERIDIAN_ML_BUILD_TIME`、`MERIDIAN_ML_BUILD_STAMP_FILE` | 空 | `build_identity` 的来源，由 `Dockerfile` 设置 |

## 本地开发

模型文件放在 `model-cache/`（gitignored，约 470MB，`Dockerfile` 也从这里 COPY）。新机器先把
`intfloat/multilingual-e5-small` 的 `config.json`、`tokenizer*.json`、`sentencepiece.bpe.model`、
`special_tokens_map.json`、`model.safetensors` 下到这个目录。

```bash
cd services/meridian-ml-service
uv venv && uv pip install -e ".[dev]"
API_TOKEN=dev-token-123 EMBEDDING_MODEL_NAME=$PWD/model-cache \
  .venv/bin/uvicorn src.main:app --host 127.0.0.1 --port 8081
curl http://127.0.0.1:8081/health
```

backend 本地指向它：`apps/backend/.dev.vars` 里设 `MERIDIAN_ML_SERVICE_URL=http://127.0.0.1:8081`。

## 测试

```bash
cd services/meridian-ml-service
.venv/bin/python -m pytest test/test_clustering_golden.py -q
```

`/ai-worker/clustering` 的 golden 快照测试：`test/golden/request.json` 是 backend 实际发送形状的请求，
`response.json` 是期望输出。行为有意改变时加 `UPDATE_GOLDEN=1` 重写，重新生成请求见 `test/golden/generate_request.py`。
不需要加载模型，几秒跑完。

## 部署（Cloudflare Containers）

```bash
cd services/meridian-ml-service/cf-worker
npx wrangler@4.120.0 deploy          # 用 ../Dockerfile 构建镜像并推送，Worker 名 meridian-ml-service
npx wrangler@4.120.0 secret put API_TOKEN
```

- 容器配置在 `cf-worker/wrangler.jsonc`：`standard-1`、最多 3 个实例；`cf-worker/src/index.ts` 里 `sleepAfter = '10m'`。
- 构建前 `model-cache/` 必须就位，否则镜像里没有模型。
- 部署后看 `/health` 的 `build_identity.build_time` 是不是刚才的时间，确认新镜像已在运行。
- 永不从仓库根部署。
