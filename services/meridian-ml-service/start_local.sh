#!/bin/bash

# Meridian ML Service 本地启动脚本

set -e

echo "🤖 Meridian ML Service 本地启动"
echo "================================="

# 检查Python版本
PYTHON_VERSION=$(python3 --version 2>&1 | cut -d" " -f2 | cut -d"." -f1,2)
echo "✓ Python版本: $PYTHON_VERSION"

# 检查是否在正确的目录
if [ ! -f "pyproject.toml" ]; then
    echo "❌ 请在 services/meridian-ml-service 目录下运行此脚本"
    exit 1
fi

# 设置环境变量
echo "📝 设置环境变量..."
export API_TOKEN="${API_TOKEN:-dev-token-123}"
export EMBEDDING_MODEL_NAME="${EMBEDDING_MODEL_NAME:-intfloat/multilingual-e5-small}"
export PYTHONUNBUFFERED=1

echo "   API_TOKEN: $API_TOKEN"
echo "   EMBEDDING_MODEL_NAME: $EMBEDDING_MODEL_NAME"

# 检查依赖
echo "📦 检查依赖..."
if ! python3 -c "import fastapi, uvicorn, torch, transformers" 2>/dev/null; then
    echo "⚠️  基础依赖缺失，正在安装..."
    pip install -e .
fi

# 检查聚类依赖
echo "🔗 检查聚类依赖..."
if python3 -c "import umap, hdbscan, sklearn" 2>/dev/null; then
    echo "✅ 聚类依赖已安装"
    CLUSTERING_AVAILABLE=true
else
    echo "⚠️  聚类依赖缺失"
    echo "   安装命令: pip install umap-learn hdbscan scikit-learn"
    CLUSTERING_AVAILABLE=false
fi

# 启动选项
echo ""
echo "🚀 启动选项:"
echo "1. 直接启动服务"
echo "2. 安装聚类依赖后启动"
echo "3. 运行测试脚本"
echo "4. 使用Docker启动"

read -p "请选择 (1-4): " choice

case $choice in
    1)
        echo "🌟 启动ML服务..."
        uvicorn src.meridian_ml_service.main:app --reload --host 0.0.0.0 --port 8080
        ;;
    2)
        echo "📦 安装聚类依赖..."
        pip install umap-learn hdbscan scikit-learn
        echo "🌟 启动ML服务..."
        uvicorn src.meridian_ml_service.main:app --reload --host 0.0.0.0 --port 8080
        ;;
    3)
        if [ "$CLUSTERING_AVAILABLE" = true ]; then
            echo "🧪 运行测试脚本..."
            pip install httpx > /dev/null 2>&1
            python test_local.py
        else
            echo "❌ 需要先安装聚类依赖才能运行完整测试"
        fi
        ;;
    4)
        echo "🐳 使用Docker启动..."
        if [ -f "docker-compose.dev.yml" ]; then
            docker-compose -f docker-compose.dev.yml up --build
        else
            echo "❌ docker-compose.dev.yml 文件不存在"
        fi
        ;;
    *)
        echo "❌ 无效选择"
        exit 1
        ;;
esac 