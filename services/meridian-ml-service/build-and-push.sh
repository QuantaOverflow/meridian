#!/bin/bash

# Meridian ML Service - Docker Hub 构建和推送脚本

set -e

# 配置
DOCKER_USERNAME="${DOCKER_USERNAME:-your-username}"
IMAGE_NAME="meridian-ml-service"
VERSION="0.3.0"
LATEST_TAG="latest"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Meridian ML Service Docker 构建脚本${NC}"
echo "======================================"

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
echo ""

# 确认构建
read -p "继续构建? (y/N): " confirm
if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}❌ 构建已取消${NC}"
    exit 0
fi

# 构建镜像
echo -e "${GREEN}🔨 开始构建镜像...${NC}"
docker build \
    -f Dockerfile.production \
    -t "$VERSION_TAG" \
    -t "$LATEST_IMAGE" \
    . || {
    echo -e "${RED}❌ 构建失败${NC}"
    exit 1
}

echo -e "${GREEN}✅ 镜像构建成功${NC}"

# 显示镜像信息
echo -e "${BLUE}📊 镜像信息:${NC}"
docker images "$FULL_IMAGE_NAME" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"

# 测试镜像
echo ""
echo -e "${YELLOW}🧪 测试镜像...${NC}"
if docker run --rm -d --name test-ml-service -p 8081:8080 "$VERSION_TAG" >/dev/null; then
    sleep 10
    if curl -s http://localhost:8081/health >/dev/null; then
        echo -e "${GREEN}✅ 镜像测试成功${NC}"
        docker stop test-ml-service >/dev/null
    else
        echo -e "${RED}❌ 镜像测试失败 - 健康检查不通过${NC}"
        docker stop test-ml-service >/dev/null 2>&1
        exit 1
    fi
else
    echo -e "${RED}❌ 镜像启动失败${NC}"
    exit 1
fi

# 推送到 Docker Hub
echo ""
read -p "推送到 Docker Hub? (y/N): " push_confirm
if [[ $push_confirm =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}📤 推送镜像到 Docker Hub...${NC}"
    
    # 登录 Docker Hub
    echo "请登录 Docker Hub:"
    docker login || {
        echo -e "${RED}❌ Docker Hub 登录失败${NC}"
        exit 1
    }
    
    # 推送版本标签
    echo "推送版本标签: $VERSION_TAG"
    docker push "$VERSION_TAG" || {
        echo -e "${RED}❌ 推送版本标签失败${NC}"
        exit 1
    }
    
    # 推送 latest 标签
    echo "推送 latest 标签: $LATEST_IMAGE"
    docker push "$LATEST_IMAGE" || {
        echo -e "${RED}❌ 推送 latest 标签失败${NC}"
        exit 1
    }
    
    echo -e "${GREEN}🎉 镜像推送成功!${NC}"
    echo ""
    echo -e "${BLUE}📝 使用方法:${NC}"
    echo "  拉取镜像: docker pull $VERSION_TAG"
    echo "  运行容器: docker run -d -p 8080:8080 -e API_TOKEN=your-token $VERSION_TAG"
    echo ""
else
    echo -e "${YELLOW}📝 镜像已构建但未推送${NC}"
    echo ""
    echo -e "${BLUE}📝 本地使用:${NC}"
    echo "  运行容器: docker run -d -p 8080:8080 -e API_TOKEN=your-token $VERSION_TAG"
    echo ""
fi

echo -e "${GREEN}✅ 脚本执行完成${NC}" 