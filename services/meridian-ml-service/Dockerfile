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
COPY pyproject.toml uv.lock* ./

# Install dependencies efficiently
RUN uv pip install --system --no-cache --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cpu --requirement pyproject.toml && \
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

WORKDIR /app

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
COPY --chown=appuser:appuser pyproject.toml ./

# Environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/home/appuser/app:${PYTHONPATH} \
    EMBEDDING_MODEL_NAME=/home/appuser/model

# --- 构建身份注入（消费方：src/main.py 的 get_build_identity）---
# 放在所有 COPY 之后：改 SHA 不会让依赖层和模型层缓存失效。
#   docker build --build-arg MERIDIAN_ML_BUILD_SHA=$(git rev-parse --short HEAD) \
#                --build-arg MERIDIAN_ML_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) .
# 没带 --build-arg 时这两个是空串，服务侧返回 "not-injected"（可判别，不崩）。
ARG MERIDIAN_ML_BUILD_SHA=""
ARG MERIDIAN_ML_BUILD_TIME=""
ENV MERIDIAN_ML_BUILD_SHA=${MERIDIAN_ML_BUILD_SHA} \
    MERIDIAN_ML_BUILD_TIME=${MERIDIAN_ML_BUILD_TIME}

# 兜底构建戳：CF Containers 走 cf-worker 的 `wrangler deploy` 构建镜像，那条路要传
# build-arg 得手改 wrangler.jsonc 的 image_vars（又变成人维护的字面量），所以镜像里
# 直接留一个真实的构建时刻。这一层在 COPY ./src 之后，源码一变必重跑；反过来，源码新
# 而镜像没重建时这个戳不会变——那正是要能被看见的信号。
RUN date -u +"%Y-%m-%dT%H:%M:%SZ" > /home/appuser/app/.build_stamp
ENV MERIDIAN_ML_BUILD_STAMP_FILE=/home/appuser/app/.build_stamp

# Expose the default port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run the application using uvicorn
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080"]
