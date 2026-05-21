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
COPY --chown=appuser:appuser ./scripts ./scripts
COPY --chown=appuser:appuser pyproject.toml ./

# Environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/home/appuser/app:${PYTHONPATH} \
    EMBEDDING_MODEL_NAME=/home/appuser/model

# Expose the default port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run the application using uvicorn
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080"]
