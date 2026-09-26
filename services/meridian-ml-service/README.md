# meridian-ml-service

Meridian 的 embedding 与聚类服务：Python / FastAPI，生产跑在 **Cloudflare Containers**
（`cf-worker/` 里的 Worker 把请求转发给容器）。唯一调用方是 `apps/backend`：

- `AutoBriefGenerationWorkflow` 聚类前批量补算缺失 embedding → `POST /embeddings`（客户端 `apps/backend/src/lib/services/ml-service.ts` 的 `generateEmbedding`）
- 随后聚类 → `POST /ai-worker/clustering`（客户端 `apps/backend/src/lib/services/ml-service.ts`）

模型是 `intfloat/multilingual-e5-small`（384 维）。聚类算法是不降维的余弦距离凝聚聚类
（average linkage）；旧的 UMAP + HDBSCAN 已于 2026-09-24 删除。
参数由 backend 的 `BRIEF_CLUSTERING_OPTIONS`（`apps/backend/src/lib/core/constants.ts`）随请求传入，
依据见 [`docs/adr/0003-cluster-as-brief-block.md`](../../docs/adr/0003-cluster-as-brief-block.md)。

## 路由（`src/main.py`）

不做鉴权：生产 Worker 关了 `workers_dev` 与 `preview_urls`，没有公网入口，唯一的入口是 backend 的
service binding `ML_SERVICE`（同账号的 Worker 才能声明）。

| 路由 | 请求 | 响应 |
|---|---|---|
| `GET /health` | — | `status`、`build_identity` |
| `POST /embeddings` | `{texts: string[]}` | `{embeddings}`（已 L2 归一化） |
| `POST /ai-worker/clustering` | `{items: [{id, embedding}], config?}`（多余字段忽略）；`config` 字段见 `src/schemas.py` 的 `BaseClusteringConfig` | `clusters[{cluster_id, size, items[{id}]}]`（`cluster_id` = -1 为噪声）、`clustering_stats`、`config_used`、`build_identity` |

`build_identity`（`build_time` / `injected`）用来确认生产跑的不是旧镜像：
backend 在每次聚类时断言它（`ml-service.ts` 的 `assertBuildIdentity`），缺字段即判定为旧镜像。
来历：2026-09-15 至 09-19 容器镜像没推上去，生产连续五天跑旧算法而 `brief_runs.status` 一直是 `COMPLETED`。

## 环境变量（`src/config.py`、`src/main.py`）

| 名称 | 默认 | 说明 |
|---|---|---|
| `EMBEDDING_MODEL_NAME` | `sentence-transformers/multilingual-e5-small` | 模型名或本地目录；镜像里设为 `/home/appuser/model` |
| `MERIDIAN_ML_BUILD_STAMP_FILE` | 空 | `build_identity` 的来源（镜像构建戳），由 `Dockerfile` 设置 |

## 本地开发

模型文件放在 `model-cache/`（gitignored，约 470MB，`Dockerfile` 也从这里 COPY）。新机器先把
`intfloat/multilingual-e5-small` 的 `config.json`、`tokenizer*.json`、`sentencepiece.bpe.model`、
`special_tokens_map.json`、`model.safetensors` 下到这个目录。

```bash
cd services/meridian-ml-service
uv sync --extra dev   # 含 dependency-groups 里的 httpx（TestClient 需要）
EMBEDDING_MODEL_NAME=$PWD/model-cache \
  .venv/bin/uvicorn src.main:app --host 127.0.0.1 --port 8081
curl http://127.0.0.1:8081/health
```

backend 经 binding `ML_SERVICE` 找名为 `meridian-ml-service` 的 Worker。本地没有 Container，由零依赖的
`dev-shim/`（同名 Worker）把请求原样转发到上面的 uvicorn，和 backend 在同一条命令里起（仓库根目录）：

```bash
pnpm -F @meridian/backend exec wrangler dev -c wrangler.jsonc -c ../../services/meridian-ml-service/dev-shim/wrangler.jsonc
```

uvicorn 换端口时在 `dev-shim/.dev.vars` 里写 `ML_LOCAL_URL=http://127.0.0.1:<port>`。没起 shim 时启动输出里
`env.ML_SERVICE` 显示 `[not connected]`，ML 调用直接报错，不会静默降级。replay 自动生成 shim 配置。

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
```

- 容器配置在 `cf-worker/wrangler.jsonc`：`standard-1`、最多 3 个实例；`cf-worker/src/index.ts` 里 `sleepAfter = '10m'`。
- 构建前 `model-cache/` 必须就位，否则镜像里没有模型。
- 部署后跑仓库根的 `scripts/check-container-deploy.sh`（0 = 镜像不比代码旧）。没有公网口，`/health` 从外面访问不到；
  运行时由 backend 每次聚类断言 `build_identity`（`buildIdentityCheck`，缺字段记 DEGRADED）。
- 不要在 dashboard 给这个 Worker 加 custom domain 或 route：服务不做鉴权，加了就是公网无鉴权入口。
- 永不从仓库根部署。
