#!/bin/bash

# Meridian ML Service - VPS一键部署脚本
# 支持多种部署方式的快速部署

set -e

# 配置
PROJECT_NAME="meridian-ml-service"
VERSION="0.3.0"
DOCKER_HUB_USER="crossovo"
REGISTRY="docker.io"
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

echo -e "${GREEN}🚀 Meridian ML Service VPS一键部署${NC}"
echo "================================================"

# 检查系统要求
check_system() {
    log_info "检查系统要求..."
    
    # 检查内存
    MEMORY_GB=$(free -g | awk '/^Mem:/{print $2}')
    if [ "$MEMORY_GB" -lt 4 ]; then
        log_warning "警告：系统内存只有 ${MEMORY_GB}GB，建议至少4GB"
        log_info "正在设置swap空间..."
        
        if [ ! -f /swapfile ]; then
            sudo fallocate -l 2G /swapfile || {
                sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
            }
            sudo chmod 600 /swapfile
            sudo mkswap /swapfile
            sudo swapon /swapfile
            echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
            log_success "已添加2GB swap空间"
        fi
    fi
    
    # 检查磁盘空间
    DISK_GB=$(df / | awk 'NR==2{print int($4/1024/1024)}')
    if [ "$DISK_GB" -lt 10 ]; then
        log_error "磁盘空间不足：${DISK_GB}GB，至少需要10GB"
        exit 1
    fi
    
    log_success "系统检查通过"
}

# 安装Docker
install_docker() {
    if ! command -v docker &> /dev/null; then
        log_info "安装Docker..."
        
        # 检测系统类型
        if [ -f /etc/debian_version ]; then
            # Debian/Ubuntu系统
            curl -fsSL https://get.docker.com -o get-docker.sh
            sudo sh get-docker.sh
            rm get-docker.sh
        elif [ -f /etc/redhat-release ]; then
            # CentOS/RHEL系统
            sudo yum install -y yum-utils
            sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
            sudo yum install -y docker-ce docker-ce-cli containerd.io
        else
            log_error "不支持的操作系统"
            exit 1
        fi
        
        # 启动Docker服务
        sudo systemctl enable docker
        sudo systemctl start docker
        
        # 添加用户到docker组
        sudo usermod -aG docker $USER
        
        log_success "Docker安装完成"
        log_warning "请重新登录以应用docker组权限，然后重新运行此脚本"
        exit 0
    else
        log_success "Docker已安装"
    fi
}

# 生成API令牌
generate_api_token() {
    if [ -z "$API_TOKEN" ]; then
        API_TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 32)
        log_info "生成API令牌: $API_TOKEN"
        echo "API_TOKEN=$API_TOKEN" > .env
        log_warning "请保存此令牌用于API访问"
    fi
}

# 方式1：从Docker Hub拉取
deploy_from_dockerhub() {
    local IMAGE_NAME="$REGISTRY/$DOCKER_HUB_USER/$PROJECT_NAME:$VERSION"
    
    log_info "尝试从Docker Hub拉取镜像..."
    
    if docker pull "$IMAGE_NAME"; then
        log_success "镜像拉取成功"
        
        # 启动容器
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
        
        return 0
    else
        log_warning "Docker Hub镜像拉取失败，尝试备用方案"
        return 1
    fi
}

# 方式2：从源码构建
deploy_from_source() {
    log_info "从源码构建部署..."
    
    # 克隆代码
    if [ ! -d "meridian" ]; then
        if command -v git &> /dev/null; then
            git clone https://github.com/crossovo/meridian.git
        else
            log_info "安装git..."
            if [ -f /etc/debian_version ]; then
                sudo apt update && sudo apt install -y git
            elif [ -f /etc/redhat-release ]; then
                sudo yum install -y git
            fi
            git clone https://github.com/crossovo/meridian.git
        fi
    fi
    
    cd meridian/services/meridian-ml-service
    
    # 构建镜像
    log_info "构建Docker镜像（这可能需要10-15分钟）..."
    docker build -t meridian-ml-service:local .
    
    # 启动容器
    docker run -d \
        --name "$CONTAINER_NAME" \
        --restart unless-stopped \
        -p "$PORT:8080" \
        -e API_TOKEN="$API_TOKEN" \
        -e EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-small \
        -e PYTHONUNBUFFERED=1 \
        -e HF_HUB_OFFLINE=0 \
        -v ml_cache:/home/appuser/.cache/huggingface \
        meridian-ml-service:local
    
    cd ../../..
}

# 方式3：使用docker-compose
deploy_with_compose() {
    log_info "使用docker-compose部署..."
    
    # 安装docker-compose
    if ! command -v docker-compose &> /dev/null; then
        log_info "安装docker-compose..."
        sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
    fi
    
    # 创建docker-compose.yml
    cat > docker-compose.yml << EOF
version: '3.8'

services:
  meridian-ml-service:
    image: crossovo/meridian-ml-service:latest
    container_name: meridian-ml-service
    restart: unless-stopped
    ports:
      - "$PORT:8080"
    environment:
      - API_TOKEN=$API_TOKEN
      - EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-small
      - PYTHONUNBUFFERED=1
      - HF_HUB_OFFLINE=0
    volumes:
      - ml_cache:/home/appuser/.cache/huggingface
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 120s

volumes:
  ml_cache:
    driver: local
EOF
    
    # 启动服务
    docker-compose up -d
}

# 等待服务启动
wait_for_service() {
    log_info "等待服务启动（这可能需要几分钟，首次启动需要下载模型）..."
    
    local MAX_WAIT=300  # 5分钟
    local WAIT_TIME=0
    
    while [ $WAIT_TIME -lt $MAX_WAIT ]; do
        if curl -f "http://localhost:$PORT/health" > /dev/null 2>&1; then
            log_success "服务启动成功！"
            return 0
        fi
        
        echo -n "."
        sleep 10
        WAIT_TIME=$((WAIT_TIME + 10))
    done
    
    log_error "服务启动超时"
    log_info "查看日志："
    docker logs "$CONTAINER_NAME" --tail 50
    return 1
}

# 验证部署
verify_deployment() {
    log_info "验证部署..."
    
    # 健康检查
    local health_response=$(curl -s "http://localhost:$PORT/health")
    if echo "$health_response" | grep -q "healthy"; then
        log_success "健康检查通过"
    else
        log_error "健康检查失败"
        return 1
    fi
    
    # 测试嵌入生成
    local embed_response=$(curl -s -X POST "http://localhost:$PORT/embeddings" \
        -H "Content-Type: application/json" \
        -H "X-API-Token: $API_TOKEN" \
        -d '{"texts": ["测试"], "normalize": true}')
    
    if echo "$embed_response" | grep -q "embeddings"; then
        log_success "嵌入生成测试通过"
    else
        log_warning "嵌入生成测试可能有问题"
    fi
    
    return 0
}

# 显示部署信息
show_deployment_info() {
    echo ""
    echo -e "${GREEN}🎉 部署完成！${NC}"
    echo "================================================"
    echo "服务地址: http://localhost:$PORT"
    echo "健康检查: http://localhost:$PORT/health"
    echo "API文档: http://localhost:$PORT/docs"
    echo "API令牌: $API_TOKEN"
    echo ""
    echo "常用命令:"
    echo "  查看日志: docker logs $CONTAINER_NAME"
    echo "  重启服务: docker restart $CONTAINER_NAME"
    echo "  停止服务: docker stop $CONTAINER_NAME"
    echo "  删除服务: docker rm -f $CONTAINER_NAME"
    echo ""
    echo "API使用示例:"
    echo "  curl -X POST http://localhost:$PORT/embeddings \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -H 'X-API-Token: $API_TOKEN' \\"
    echo "    -d '{\"texts\": [\"Hello World\"], \"normalize\": true}'"
    echo ""
}

# 清理旧部署
cleanup_old_deployment() {
    log_info "清理旧部署..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
}

# 主函数
main() {
    # 解析命令行参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            --port)
                PORT="$2"
                shift 2
                ;;
            --token)
                API_TOKEN="$2"
                shift 2
                ;;
            --help)
                echo "用法: $0 [选项]"
                echo ""
                echo "选项:"
                echo "  --port <port>     服务端口 (默认: 8080)"
                echo "  --token <token>   API令牌 (自动生成如果未指定)"
                echo "  --help           显示此帮助信息"
                exit 0
                ;;
            *)
                log_error "未知选项: $1"
                exit 1
                ;;
        esac
    done
    
    # 执行部署流程
    check_system
    install_docker
    generate_api_token
    cleanup_old_deployment
    
    # 尝试多种部署方式
    if deploy_from_dockerhub; then
        log_success "使用Docker Hub镜像部署成功"
    elif deploy_from_source; then
        log_success "使用源码构建部署成功"
    else
        log_error "所有部署方式都失败了"
        exit 1
    fi
    
    # 等待服务启动并验证
    if wait_for_service && verify_deployment; then
        show_deployment_info
        
        # 保存部署信息
        cat > deployment-info.txt << EOF
Meridian ML Service 部署信息
=============================
部署时间: $(date)
服务端口: $PORT
API令牌: $API_TOKEN
容器名称: $CONTAINER_NAME
镜像版本: $VERSION

服务地址: http://localhost:$PORT
健康检查: http://localhost:$PORT/health
API文档: http://localhost:$PORT/docs
EOF
        
        log_success "部署信息已保存到 deployment-info.txt"
    else
        log_error "部署验证失败"
        exit 1
    fi
}

# 运行主函数
main "$@" 