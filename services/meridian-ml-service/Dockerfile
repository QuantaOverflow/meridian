# syntax=docker/dockerfile:1

# --- Builder Stage ---
FROM python:3.11-slim AS builder

# Install build tools first
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN pip install uv

WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock ./

# 严格按 uv.lock 装（--frozen：lock 与 pyproject 不一致就失败，不静默重新解析）。
# 以前是 `--requirement pyproject.toml`，lock 根本没参与，每次构建都拿当时最新版本。
# torch 的 CPU 版来自 PyTorch 源（pyproject 的 [tool.uv.sources]），这里仍要带上该源。
RUN uv export --frozen --no-dev --no-hashes --no-emit-project -o /tmp/requirements.txt && \
    uv pip install --system --no-cache --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cpu --requirement /tmp/requirements.txt && \
    rm -rf /root/.cache /tmp/* /var/tmp/*

# --- Runtime Stage ---
FROM python:3.11-slim

# Install only runtime essentials and clean up in one layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create a non-root user for security
RUN useradd --create-home --shell /bin/bash appuser
USER appuser
WORKDIR /home/appuser/app

# Copy installed dependencies from the builder stage's system python env
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy pre-downloaded model files (downloaded locally to avoid HF rate limits)
COPY --chown=appuser:appuser ./model-cache /home/appuser/model

# Copy your application code
COPY --chown=appuser:appuser ./src ./src

# Environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/home/appuser/app:${PYTHONPATH} \
    EMBEDDING_MODEL_NAME=/home/appuser/model

# 构建身份（消费方：src/main.py 的 get_build_identity）。镜像里留一个真实的构建时刻，不靠人维护的字面量。
# 这一层在 COPY ./src 之后，源码一变必重跑；反过来，源码新而镜像没重建时这个戳不会变——那正是要能被看见的信号。
#
# 部署时的提交（消费方：src/main.py 的 get_git_identity，/health 里给运维台看）：scripts/deploy.sh 部署时生成一份
# 临时 wrangler 配置，把 cf-worker/wrangler.jsonc 里 image_vars 的占位值换成真值，wrangler 把 image_vars 当
# build arg 传进来。不经脚本直接 `wrangler deploy` 时进来的是占位值 not-injected，/health 报 null。
# ARG 声明在构建戳之前：提交变了，下面的 RUN 缓存失效，构建戳就是这次部署构建镜像的时刻。
ARG GIT_COMMIT=""
ARG GIT_TITLE=""
ARG GIT_DIRTY=""
RUN date -u +"%Y-%m-%dT%H:%M:%SZ" > /home/appuser/app/.build_stamp
ENV MERIDIAN_ML_BUILD_STAMP_FILE=/home/appuser/app/.build_stamp \
    MERIDIAN_ML_GIT_COMMIT="${GIT_COMMIT}" \
    MERIDIAN_ML_GIT_TITLE="${GIT_TITLE}" \
    MERIDIAN_ML_GIT_DIRTY="${GIT_DIRTY}"

# Expose the default port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run the application using uvicorn
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080"]
