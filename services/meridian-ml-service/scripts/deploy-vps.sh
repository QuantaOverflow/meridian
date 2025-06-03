#!/bin/bash

# Meridian ML Service - VPS部署脚本
# 在VPS上拉取并运行Docker镜像

set -e

# 配置
PROJECT_NAME="meridian-ml-service"
VERSION="0.3.0"
DOCKER_HUB_USER="${DOCKER_HUB_USER:-}"
REGISTRY="${REGISTRY:-docker.io}"
CONTAINER_NAME="meridian-ml-service"
PORT="${PORT:-8080}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 日志函数
log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

echo -e "${GREEN}🚢 Meridian ML Service VPS部署脚本${NC}"
echo "========================================"

# 解析命令行参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --user)
            DOCKER_HUB_USER="$2"
            shift 2
            ;;
        --registry)
            REGISTRY="$2"
            shift 2
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --help)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --user <username>     Docker Hub用户名"
            echo "  --registry <url>      镜像仓库地址 (默认: docker.io)"
            echo "  --port <port>         服务端口 (默认: 8080)"
            echo "  --version <version>   镜像版本 (默认: 0.3.0)"
            echo "  --help               显示此帮助信息"
            echo ""
            echo "环境变量:"
            echo "  DOCKER_HUB_USER      Docker Hub用户名"
            echo "  REGISTRY             镜像仓库地址"
            echo "  PORT                 服务端口"
            echo "  API_TOKEN            API访问令牌"
            echo ""
            echo "示例:"
            echo "  $0 --user myuser                    # 部署指定用户的镜像"
            echo "  $0 --user myuser --port 8081        # 部署到指定端口"
            exit 0
            ;;
        *)
            log_error "未知选项: $1"
            exit 1
            ;;
    esac
done

# 验证Docker Hub用户名
if [ -z "$DOCKER_HUB_USER" ]; then
    log_error "请指定Docker Hub用户名"
    echo "使用 --user <username> 或设置环境变量 DOCKER_HUB_USER"
    exit 1
fi

# 设置镜像名称
IMAGE_NAME="$REGISTRY/$DOCKER_HUB_USER/$PROJECT_NAME:$VERSION"

log_info "部署配置:"
echo "  镜像: $IMAGE_NAME"
echo "  容器名: $CONTAINER_NAME"
echo "  端口: $PORT"

# 检查Docker是否运行
if ! docker info > /dev/null 2>&1; then
    log_error "Docker未运行，请启动Docker"
    exit 1
fi

# 停止并删除旧容器
log_info "停止旧容器..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

# 拉取最新镜像
log_info "拉取镜像: $IMAGE_NAME"
if docker pull "$IMAGE_NAME"; then
    log_success "镜像拉取成功"
else
    log_error "镜像拉取失败"
    exit 1
fi

# 生成API令牌（如果未设置）
if [ -z "$API_TOKEN" ]; then
    API_TOKEN=$(openssl rand -hex 32)
    log_warning "生成随机API令牌: $API_TOKEN"
    echo "请保存此令牌用于API访问"
fi

# 启动新容器
log_info "启动新容器..."
docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p "$PORT:8080" \
    -e API_TOKEN="$API_TOKEN" \
    -e EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-small \
    -e PYTHONUNBUFFERED=1 \
    -e HF_HUB_OFFLINE=0 \
    -v ml_cache:/home/appuser/.cache/huggingface \
    "$IMAGE_NAME"

if [ $? -eq 0 ]; then
    log_success "容器启动成功"
else
    log_error "容器启动失败"
    exit 1
fi

# 等待服务启动
log_info "等待服务启动..."
sleep 60

# 健康检查
log_info "执行健康检查..."
if curl -f "http://localhost:$PORT/health" > /dev/null 2>&1; then
    log_success "部署成功！"
    echo ""
    echo "服务信息:"
    echo "  URL: http://localhost:$PORT"
    echo "  健康检查: http://localhost:$PORT/health"
    echo "  API令牌: $API_TOKEN"
    echo ""
    echo "查看日志: docker logs $CONTAINER_NAME"
    echo "停止服务: docker stop $CONTAINER_NAME"
else
    log_error "健康检查失败"
    echo ""
    echo "查看容器日志:"
    docker logs "$CONTAINER_NAME" --tail 50
    exit 1
fi

log_success "VPS部署完成！" 