#!/bin/bash

# Meridian ML Service - VPS 部署脚本

set -e

# 配置
DOCKER_USERNAME="${DOCKER_USERNAME:-your-username}"
IMAGE_NAME="meridian-ml-service"
VERSION="${VERSION:-latest}"
CONTAINER_NAME="meridian-ml-service"
PORT="${PORT:-8080}"
API_TOKEN="${API_TOKEN:-please-set-your-token}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Meridian ML Service VPS 部署脚本${NC}"
echo "======================================="

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker 未安装，正在安装...${NC}"
    
    # 安装 Docker (适用于 Ubuntu/Debian)
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    
    echo -e "${GREEN}✅ Docker 安装完成，请重新登录后运行此脚本${NC}"
    exit 0
fi

# 检查 Docker 是否运行
if ! docker info >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️ 启动 Docker 服务...${NC}"
    sudo systemctl start docker
    sudo systemctl enable docker
fi

# 获取配置信息
echo -e "${YELLOW}📝 部署配置:${NC}"
read -p "Docker Hub 用户名 [$DOCKER_USERNAME]: " input_username
DOCKER_USERNAME="${input_username:-$DOCKER_USERNAME}"

read -p "镜像版本 [$VERSION]: " input_version
VERSION="${input_version:-$VERSION}"

read -p "服务端口 [$PORT]: " input_port
PORT="${input_port:-$PORT}"

read -p "API Token [$API_TOKEN]: " input_token
API_TOKEN="${input_token:-$API_TOKEN}"

# 构建完整镜像名
FULL_IMAGE_NAME="$DOCKER_USERNAME/$IMAGE_NAME:$VERSION"

echo ""
echo -e "${BLUE}🔧 部署配置:${NC}"
echo "  镜像: $FULL_IMAGE_NAME"
echo "  容器名: $CONTAINER_NAME"
echo "  端口: $PORT"
echo "  API Token: ${API_TOKEN:0:10}..." 
echo ""

# 确认部署
read -p "开始部署? (y/N): " confirm
if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}❌ 部署已取消${NC}"
    exit 0
fi

# 停止并删除现有容器
echo -e "${YELLOW}🧹 清理现有容器...${NC}"
if docker ps -a | grep -q "$CONTAINER_NAME"; then
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
    echo -e "${GREEN}✅ 已清理现有容器${NC}"
fi

# 拉取最新镜像
echo -e "${GREEN}📥 拉取镜像: $FULL_IMAGE_NAME${NC}"
docker pull "$FULL_IMAGE_NAME" || {
    echo -e "${RED}❌ 镜像拉取失败，请检查镜像名称和网络连接${NC}"
    exit 1
}

# 运行容器
echo -e "${GREEN}🚀 启动容器...${NC}"
docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p "$PORT:8080" \
    -e API_TOKEN="$API_TOKEN" \
    -e PYTHONUNBUFFERED=1 \
    "$FULL_IMAGE_NAME" || {
    echo -e "${RED}❌ 容器启动失败${NC}"
    exit 1
}

# 等待服务启动
echo -e "${YELLOW}⏳ 等待服务启动...${NC}"
sleep 15

# 健康检查
echo -e "${YELLOW}🔍 执行健康检查...${NC}"
for i in {1..10}; do
    if curl -s "http://localhost:$PORT/health" >/dev/null; then
        echo -e "${GREEN}✅ 服务启动成功!${NC}"
        break
    elif [ $i -eq 10 ]; then
        echo -e "${RED}❌ 服务启动失败，请检查日志${NC}"
        echo "查看日志: docker logs $CONTAINER_NAME"
        exit 1
    else
        echo "  尝试 $i/10..."
        sleep 3
    fi
done

# 显示服务信息
echo ""
echo -e "${BLUE}📊 部署信息:${NC}"
echo "  容器状态: $(docker ps --filter name=$CONTAINER_NAME --format '{{.Status}}')"
echo "  内存使用: $(docker stats --no-stream --format '{{.MemUsage}}' $CONTAINER_NAME)"
echo "  服务地址: http://localhost:$PORT"
echo "  健康检查: http://localhost:$PORT/health"
echo "  API文档: http://localhost:$PORT/docs"

# 显示管理命令
echo ""
echo -e "${BLUE}🛠️ 管理命令:${NC}"
echo "  查看日志: docker logs -f $CONTAINER_NAME"
echo "  停止服务: docker stop $CONTAINER_NAME"
echo "  启动服务: docker start $CONTAINER_NAME"
echo "  重启服务: docker restart $CONTAINER_NAME"
echo "  删除容器: docker rm $CONTAINER_NAME"
echo "  更新镜像: docker pull $FULL_IMAGE_NAME && docker stop $CONTAINER_NAME && docker rm $CONTAINER_NAME && 重新运行此脚本"

# 测试 API
echo ""
read -p "测试 API 接口? (y/N): " test_confirm
if [[ $test_confirm =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}🧪 测试 API...${NC}"
    
    echo "1. 基础信息:"
    curl -s "http://localhost:$PORT/" | python3 -m json.tool 2>/dev/null || echo "  API 响应获取失败"
    
    echo ""
    echo "2. 健康检查:"
    curl -s "http://localhost:$PORT/health" | python3 -m json.tool 2>/dev/null || echo "  健康检查失败"
    
    echo ""
    echo "3. 嵌入生成测试:"
    curl -s -X POST "http://localhost:$PORT/embeddings" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $API_TOKEN" \
        -d '{"texts": ["测试文本"]}' | \
        python3 -c "import sys, json; data=json.load(sys.stdin); print(f'嵌入维度: {len(data[\"embeddings\"][0]) if data.get(\"embeddings\") else \"获取失败\"}')" 2>/dev/null || echo "  嵌入生成测试失败"
fi

echo ""
echo -e "${GREEN}🎉 部署完成!${NC}"

# 设置防火墙 (可选)
if command -v ufw &> /dev/null; then
    echo ""
    read -p "配置防火墙允许端口 $PORT? (y/N): " firewall_confirm
    if [[ $firewall_confirm =~ ^[Yy]$ ]]; then
        sudo ufw allow "$PORT"
        echo -e "${GREEN}✅ 防火墙规则已添加${NC}"
    fi
fi

echo ""
echo -e "${BLUE}📝 下一步建议:${NC}"
echo "  1. 配置反向代理 (Nginx/Caddy) 为服务添加 HTTPS"
echo "  2. 设置监控和日志收集"
echo "  3. 配置自动备份和更新策略"
echo "  4. 考虑使用 Docker Compose 进行更复杂的部署" 