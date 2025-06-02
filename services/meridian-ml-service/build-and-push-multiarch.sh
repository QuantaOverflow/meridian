#!/bin/bash

# Meridian ML Service - 多架构 Docker Hub 构建和推送脚本

set -e

# 配置
DOCKER_USERNAME="${DOCKER_USERNAME:-crossovo}"
IMAGE_NAME="meridian-ml-service"
VERSION="0.3.0"
LATEST_TAG="latest"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Meridian ML Service 多架构 Docker 构建脚本${NC}"
echo "=============================================="

# 检查是否在正确目录
if [ ! -f "Dockerfile.production" ]; then
    echo -e "${RED}❌ 错误: 请在 services/meridian-ml-service 目录下运行此脚本${NC}"
    exit 1
fi

# 检查 Docker 是否运行
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}❌ 错误: Docker 未运行或无权限访问${NC}"
    exit 1
fi

# 检查 buildx 是否可用
if ! docker buildx version >/dev/null 2>&1; then
    echo -e "${RED}❌ 错误: Docker buildx 不可用，请升级 Docker 到支持 buildx 的版本${NC}"
    exit 1
fi

# 获取用户输入
echo -e "${YELLOW}📝 配置信息:${NC}"
read -p "Docker Hub 用户名 [$DOCKER_USERNAME]: " input_username
DOCKER_USERNAME="${input_username:-$DOCKER_USERNAME}"

read -p "镜像版本 [$VERSION]: " input_version
VERSION="${input_version:-$VERSION}"

# 构建镜像标签
FULL_IMAGE_NAME="$DOCKER_USERNAME/$IMAGE_NAME"
VERSION_TAG="$FULL_IMAGE_NAME:$VERSION"
LATEST_IMAGE="$FULL_IMAGE_NAME:$LATEST_TAG"

echo ""
echo -e "${BLUE}🔧 构建配置:${NC}"
echo "  用户名: $DOCKER_USERNAME"
echo "  镜像名: $IMAGE_NAME"  
echo "  版本标签: $VERSION_TAG"
echo "  最新标签: $LATEST_IMAGE"
echo "  目标架构: linux/amd64,linux/arm64"
echo ""

# 确认构建
read -p "继续多架构构建? (y/N): " confirm
if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}❌ 构建已取消${NC}"
    exit 0
fi

# 登录 Docker Hub（多架构构建需要推送）
echo -e "${GREEN}🔐 登录 Docker Hub...${NC}"
echo "请登录 Docker Hub:"
docker login || {
    echo -e "${RED}❌ Docker Hub 登录失败${NC}"
    exit 1
}

# 创建 buildx builder（如果不存在）
BUILDER_NAME="meridian-multiarch-builder"
if ! docker buildx inspect $BUILDER_NAME >/dev/null 2>&1; then
    echo -e "${GREEN}🔧 创建多架构构建器...${NC}"
    docker buildx create --name $BUILDER_NAME --driver docker-container --use || {
        echo -e "${RED}❌ 创建构建器失败${NC}"
        exit 1
    }
else
    echo -e "${GREEN}🔧 使用现有多架构构建器...${NC}"
    docker buildx use $BUILDER_NAME
fi

# 启动构建器
echo -e "${GREEN}🚀 启动构建器...${NC}"
docker buildx inspect --bootstrap || {
    echo -e "${RED}❌ 构建器启动失败${NC}"
    exit 1
}

# 多架构构建并推送
echo -e "${GREEN}🔨 开始多架构构建和推送...${NC}"
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    -f Dockerfile.production \
    -t "$VERSION_TAG" \
    -t "$LATEST_IMAGE" \
    --push \
    . || {
    echo -e "${RED}❌ 多架构构建失败${NC}"
    exit 1
}

echo -e "${GREEN}🎉 多架构镜像构建和推送成功!${NC}"
echo ""
echo -e "${BLUE}📝 使用方法:${NC}"
echo "  拉取镜像: docker pull $VERSION_TAG"
echo "  运行容器 (amd64): docker run -d -p 8080:8080 -e API_TOKEN=your-token $VERSION_TAG"
echo "  运行容器 (arm64): docker run -d -p 8080:8080 -e API_TOKEN=your-token $VERSION_TAG"
echo ""
echo -e "${BLUE}📊 验证多架构支持:${NC}"
echo "  检查清单: docker buildx imagetools inspect $VERSION_TAG"
echo ""
echo -e "${GREEN}✅ 现在可以在 VPS (x86_64) 上成功部署了!${NC}" 