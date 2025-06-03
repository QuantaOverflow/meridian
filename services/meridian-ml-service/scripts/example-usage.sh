#!/bin/bash

# Meridian ML Service - 使用示例脚本
# 展示如何构建、推送和部署 Docker 镜像

echo "🚀 Meridian ML Service 使用示例"
echo "================================"

# 设置你的 Docker Hub 用户名
DOCKER_HUB_USER="crossovoo"

echo ""
echo "请将 DOCKER_HUB_USER 设置为你的实际 Docker Hub 用户名"
echo "当前设置: $DOCKER_HUB_USER"
echo ""

if [ "$DOCKER_HUB_USER" = "your-dockerhub-username" ]; then
    echo "❌ 请先修改脚本中的 DOCKER_HUB_USER 变量"
    exit 1
fi

echo "选择操作:"
echo "1) 仅本地构建"
echo "2) 构建并推送到 Docker Hub"
echo "3) 在当前机器上部署（模拟 VPS）"
echo "4) 显示所有可用命令"
echo ""

read -p "请选择 (1-4): " choice

case $choice in
    1)
        echo "🔨 执行本地构建..."
        ./build-and-push.sh --build-only
        ;;
    2)
        echo "🚀 执行构建并推送..."
        echo "注意: 需要先登录 Docker Hub (docker login)"
        ./build-and-push.sh --push --user "$DOCKER_HUB_USER"
        ;;
    3)
        echo "🚢 执行本地部署..."
        ./deploy-vps.sh --user "$DOCKER_HUB_USER" --port 8081
        ;;
    4)
        echo ""
        echo "📚 所有可用命令:"
        echo ""
        echo "构建脚本 (build-and-push.sh):"
        echo "  ./build-and-push.sh --build-only                    # 仅本地构建"
        echo "  ./build-and-push.sh --push --user $DOCKER_HUB_USER  # 构建并推送"
        echo "  ./build-and-push.sh --help                          # 查看帮助"
        echo ""
        echo "部署脚本 (deploy-vps.sh):"
        echo "  ./deploy-vps.sh --user $DOCKER_HUB_USER             # 基本部署"
        echo "  ./deploy-vps.sh --user $DOCKER_HUB_USER --port 8081 # 指定端口"
        echo "  ./deploy-vps.sh --help                              # 查看帮助"
        echo ""
        echo "Docker Compose:"
        echo "  docker-compose up -d                                # 启动本地开发环境"
        echo "  docker-compose logs -f                              # 查看日志"
        echo "  docker-compose down                                 # 停止服务"
        echo ""
        echo "手动 Docker 命令:"
        echo "  docker build -t meridian-ml-service:0.3.0 .         # 构建镜像"
        echo "  docker run -p 8080:8080 -e API_TOKEN=test meridian-ml-service:0.3.0  # 运行容器"
        echo ""
        ;;
    *)
        echo "❌ 无效选择"
        exit 1
        ;;
esac

echo ""
echo "✅ 操作完成！" 