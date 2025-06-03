#!/bin/bash

# Meridian ML Service - Docker构建和推送脚本
# 版本: 0.3.0

set -e

# 读取项目配置
PROJECT_NAME="meridian-ml-service"
VERSION=$(grep '^version = ' pyproject.toml | sed 's/version = "\(.*\)"/\1/')
DEFAULT_REGISTRY="docker.io"

# 配置变量
DOCKER_HUB_USER="${DOCKER_HUB_USER:-}"
REGISTRY="${REGISTRY:-$DEFAULT_REGISTRY}"
PLATFORM="${PLATFORM:-linux/amd64}"
BUILD_CONTEXT="."

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

echo -e "${GREEN}🚀 Meridian ML Service Docker 构建脚本${NC}"
echo "========================================"
log_info "项目: $PROJECT_NAME"
log_info "版本: $VERSION"

# 解析命令行参数
BUILD_ONLY=false
PUSH_TO_REGISTRY=false
CLEAN_BEFORE_BUILD=false
NO_CACHE=false

show_help() {
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --build-only          仅构建，不推送"
    echo "  --push               构建并推送到镜像仓库"
    echo "  --user <username>     Docker Hub用户名"
    echo "  --registry <url>      镜像仓库地址 (默认: docker.io)"
    echo "  --platform <platform> 目标平台 (默认: linux/amd64)"
    echo "  --clean              构建前清理相关镜像"
    echo "  --no-cache           不使用缓存构建"
    echo "  --help               显示此帮助信息"
    echo ""
    echo "环境变量:"
    echo "  DOCKER_HUB_USER      Docker Hub用户名"
    echo "  REGISTRY             镜像仓库地址"
    echo "  PLATFORM             目标平台"
    echo ""
    echo "示例:"
    echo "  $0 --build-only                    # 仅本地构建"
    echo "  $0 --push --user myuser            # 构建并推送"
    echo "  $0 --push --user myuser --clean    # 清理后构建并推送"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --build-only)
            BUILD_ONLY=true
            shift
            ;;
        --push)
            PUSH_TO_REGISTRY=true
            shift
            ;;
        --user)
            DOCKER_HUB_USER="$2"
            shift 2
            ;;
        --registry)
            REGISTRY="$2"
            shift 2
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        --clean)
            CLEAN_BEFORE_BUILD=true
            shift
            ;;
        --no-cache)
            NO_CACHE=true
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            log_error "未知选项: $1"
            show_help
            exit 1
            ;;
    esac
done

# 检查Docker是否运行
if ! docker info > /dev/null 2>&1; then
    log_error "Docker未运行，请启动Docker"
    exit 1
fi

# 验证用户名（如果需要推送）
if [ "$PUSH_TO_REGISTRY" = true ] && [ -z "$DOCKER_HUB_USER" ]; then
    log_error "推送到仓库需要指定用户名"
    echo "使用 --user <username> 或设置环境变量 DOCKER_HUB_USER"
    exit 1
fi

# 设置镜像标签
LOCAL_IMAGE="$PROJECT_NAME:$VERSION"
LOCAL_IMAGE_LATEST="$PROJECT_NAME:latest"

if [ -n "$DOCKER_HUB_USER" ]; then
    REMOTE_IMAGE="$REGISTRY/$DOCKER_HUB_USER/$PROJECT_NAME:$VERSION"
    REMOTE_IMAGE_LATEST="$REGISTRY/$DOCKER_HUB_USER/$PROJECT_NAME:latest"
fi

# 显示构建信息
echo ""
log_info "构建配置:"
echo "  本地镜像: $LOCAL_IMAGE"
echo "  平台: $PLATFORM"
echo "  注册表: $REGISTRY"
if [ -n "$DOCKER_HUB_USER" ]; then
    echo "  远程镜像: $REMOTE_IMAGE"
fi
echo "  仅构建: $BUILD_ONLY"
echo "  推送: $PUSH_TO_REGISTRY"
echo "  清理: $CLEAN_BEFORE_BUILD"
echo "  无缓存: $NO_CACHE"

# 确认继续
if [ "$BUILD_ONLY" = false ] && [ "$PUSH_TO_REGISTRY" = false ]; then
    BUILD_ONLY=true
    log_warning "未指定操作，默认仅构建"
fi

echo ""
read -p "确认继续？(y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "操作已取消"
    exit 0
fi

# 清理旧镜像（如果指定）
if [ "$CLEAN_BEFORE_BUILD" = true ]; then
    log_info "清理旧镜像..."
    docker rmi "$LOCAL_IMAGE" 2>/dev/null || true
    docker rmi "$LOCAL_IMAGE_LATEST" 2>/dev/null || true
    if [ -n "$DOCKER_HUB_USER" ]; then
        docker rmi "$REMOTE_IMAGE" 2>/dev/null || true
        docker rmi "$REMOTE_IMAGE_LATEST" 2>/dev/null || true
    fi
    log_success "旧镜像清理完成"
fi

# 构建镜像
log_info "开始构建镜像..."

BUILD_ARGS="--platform $PLATFORM"
BUILD_ARGS="$BUILD_ARGS --tag $LOCAL_IMAGE"
BUILD_ARGS="$BUILD_ARGS --tag $LOCAL_IMAGE_LATEST"

if [ "$NO_CACHE" = true ]; then
    BUILD_ARGS="$BUILD_ARGS --no-cache"
fi

echo "执行: docker build $BUILD_ARGS $BUILD_CONTEXT"
if docker build $BUILD_ARGS $BUILD_CONTEXT; then
    log_success "镜像构建成功"
else
    log_error "镜像构建失败"
    exit 1
fi

# 显示镜像信息
log_info "构建结果:"
docker images "$PROJECT_NAME" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"

# 健康检查
log_info "执行健康检查..."
TEST_PORT=18080
CONTAINER_ID=$(docker run -d -p "$TEST_PORT:8080" \
    -e API_TOKEN=test-token \
    -e EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-small \
    "$LOCAL_IMAGE")

sleep 15

if curl -f "http://localhost:$TEST_PORT/health" > /dev/null 2>&1; then
    log_success "健康检查通过"
else
    log_warning "健康检查失败，查看日志"
    docker logs "$CONTAINER_ID" --tail 20
fi

# 清理测试容器
docker stop "$CONTAINER_ID" > /dev/null 2>&1
docker rm "$CONTAINER_ID" > /dev/null 2>&1

if [ "$BUILD_ONLY" = true ]; then
    log_success "构建完成"
    echo ""
    echo "运行镜像:"
    echo "  docker run -p 8080:8080 -e API_TOKEN=your-token $LOCAL_IMAGE"
    exit 0
fi

# 推送到镜像仓库
if [ "$PUSH_TO_REGISTRY" = true ]; then
    log_info "推送到镜像仓库..."
    
    # 检查登录状态
    if ! docker info 2>/dev/null | grep -q "Username"; then
        log_info "请登录镜像仓库:"
        docker login "$REGISTRY"
    fi
    
    # 重新标记镜像
    docker tag "$LOCAL_IMAGE" "$REMOTE_IMAGE"
    docker tag "$LOCAL_IMAGE_LATEST" "$REMOTE_IMAGE_LATEST"
    
    # 推送镜像
    log_info "推送 $REMOTE_IMAGE..."
    if docker push "$REMOTE_IMAGE"; then
        log_success "版本镜像推送成功"
    else
        log_error "版本镜像推送失败"
        exit 1
    fi
    
    log_info "推送 $REMOTE_IMAGE_LATEST..."
    if docker push "$REMOTE_IMAGE_LATEST"; then
        log_success "最新镜像推送成功"
    else
        log_error "最新镜像推送失败"
        exit 1
    fi
    
    log_success "所有镜像推送完成"
    echo ""
    echo "镜像地址:"
    echo "  $REMOTE_IMAGE"
    echo "  $REMOTE_IMAGE_LATEST"
fi

log_success "所有操作完成!" 