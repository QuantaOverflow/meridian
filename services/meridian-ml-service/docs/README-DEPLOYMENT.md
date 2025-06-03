# Meridian ML Service - VPS部署指南

## 🚀 完整部署流程

### 方式一：Docker Hub镜像部署（推荐）

#### 1. 在VPS上安装Docker

```bash
# Ubuntu/Debian系统
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker

# 或者手动安装
sudo apt update
sudo apt install -y docker.io docker-compose
sudo systemctl enable docker
sudo systemctl start docker
```

#### 2. 创建部署目录

```bash
mkdir -p ~/meridian-ml-service
cd ~/meridian-ml-service
```

#### 3. 创建docker-compose.yml

```yaml
version: '3.8'

services:
  meridian-ml-service:
    image: crossovo/meridian-ml-service:latest
    container_name: meridian-ml-service
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - API_TOKEN=${API_TOKEN:-dev-token-123}
      - EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-small
      - PYTHONUNBUFFERED=1
      - HF_HUB_OFFLINE=0
    volumes:
      - ml_cache:/home/appuser/.cache/huggingface
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 120s

volumes:
  ml_cache:
    driver: local
```

#### 4. 创建环境变量文件

```bash
cat > .env << EOF
# API认证令牌
API_TOKEN=your-secure-api-token-here

# 可选：指定镜像版本
IMAGE_TAG=latest

# 可选：自定义端口
PORT=8080
EOF
```

#### 5. 部署服务

```bash
# 拉取镜像并启动
docker-compose up -d

# 查看启动日志
docker-compose logs -f

# 等待模型下载完成（首次启动需要几分钟）
```

#### 6. 验证部署

```bash
# 健康检查
curl http://localhost:8080/health

# 测试嵌入生成
curl -X POST http://localhost:8080/embeddings \
  -H "Content-Type: application/json" \
  -H "X-API-Token: your-secure-api-token-here" \
  -d '{"texts": ["测试文本"], "normalize": true}'
```

### 方式二：从源码构建部署

#### 1. 克隆代码

```bash
git clone https://github.com/your-username/meridian.git
cd meridian/services/meridian-ml-service
```

#### 2. 构建镜像

```bash
docker build -t meridian-ml-service:local .
```

#### 3. 运行容器

```bash
docker run -d \
  --name meridian-ml-service \
  --restart unless-stopped \
  -p 8080:8080 \
  -e API_TOKEN=your-token \
  -e EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-small \
  -v ml_cache:/home/appuser/.cache/huggingface \
  meridian-ml-service:local
```

### 方式三：使用快速部署脚本

#### 1. 下载部署脚本

```bash
curl -fsSL https://raw.githubusercontent.com/your-username/meridian/main/services/meridian-ml-service/deploy-vps.sh -o deploy-vps.sh
chmod +x deploy-vps.sh
```

#### 2. 执行部署

```bash
./deploy-vps.sh --user crossovo --port 8080
```

## 🔧 生产环境配置

### 反向代理配置（Nginx）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 增加超时时间，用于大批量请求
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

### 防火墙配置

```bash
# 开放端口
sudo ufw allow 8080/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 系统资源要求

- **最小配置**：2核CPU，4GB内存，10GB存储
- **推荐配置**：4核CPU，8GB内存，20GB存储
- **高负载**：8核CPU，16GB内存，50GB存储

## 📊 监控和维护

### 查看服务状态

```bash
# 查看容器状态
docker ps | grep meridian-ml-service

# 查看日志
docker logs meridian-ml-service --tail 100 -f

# 查看资源使用
docker stats meridian-ml-service
```

### 备份和恢复

```bash
# 备份模型缓存
docker run --rm -v ml_cache:/data -v $(pwd):/backup alpine tar czf /backup/ml_cache_backup.tar.gz -C /data .

# 恢复模型缓存
docker run --rm -v ml_cache:/data -v $(pwd):/backup alpine tar xzf /backup/ml_cache_backup.tar.gz -C /data
```

### 更新服务

```bash
# 拉取最新镜像
docker-compose pull

# 重启服务
docker-compose up -d
```

## 🔐 安全配置

### 1. 修改默认API令牌

```bash
# 生成强密码
openssl rand -hex 32

# 更新环境变量
echo "API_TOKEN=your-new-secure-token" >> .env
docker-compose restart
```

### 2. 限制网络访问

```bash
# 只允许内网访问
# 修改docker-compose.yml中的ports配置
ports:
  - "127.0.0.1:8080:8080"  # 只绑定本地
```

### 3. 设置日志轮转

```bash
# 创建logrotate配置
sudo tee /etc/logrotate.d/docker > /dev/null << EOF
/var/lib/docker/containers/*/*.log {
    rotate 7
    daily
    compress
    size 100M
    missingok
    delaycompress
    copytruncate
}
EOF
```

## 🚨 故障排查

### 常见问题

1. **容器启动失败**
   ```bash
   # 查看详细错误
   docker logs meridian-ml-service
   
   # 检查端口占用
   netstat -tlnp | grep 8080
   ```

2. **模型下载失败**
   ```bash
   # 检查网络连接
   docker exec meridian-ml-service curl -I https://huggingface.co
   
   # 清理缓存重新下载
   docker volume rm ml_cache
   docker-compose up -d
   ```

3. **内存不足**
   ```bash
   # 增加swap空间
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```

### 性能优化

```bash
# 限制容器内存使用
docker run --memory=4g --memory-swap=6g ...

# 使用更快的存储
# 将模型缓存挂载到SSD
```

## 📝 API使用示例

```bash
# 设置API令牌
export API_TOKEN="your-api-token"
export BASE_URL="http://your-server:8080"

# 健康检查
curl "$BASE_URL/health"

# 生成嵌入
curl -X POST "$BASE_URL/embeddings" \
  -H "Content-Type: application/json" \
  -H "X-API-Token: $API_TOKEN" \
  -d '{"texts": ["Hello World", "机器学习"], "normalize": true}'

# 批量聚类
curl -X POST "$BASE_URL/ai-worker/clustering" \
  -H "Content-Type: application/json" \
  -H "X-API-Token: $API_TOKEN" \
  -d @cluster_data.json
```

## 🔄 自动化部署（CI/CD）

### GitHub Actions示例

```yaml
name: Deploy to VPS
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to VPS
        uses: appleboy/ssh-action@v0.1.5
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ~/meridian-ml-service
            docker-compose pull
            docker-compose up -d
```

## 📞 获取支持

如果遇到问题，请：

1. 查看日志：`docker logs meridian-ml-service`
2. 检查配置：确认API令牌和端口设置
3. 验证网络：确保可以访问HuggingFace
4. 联系技术支持：提供错误日志和系统信息

---

部署成功后，您的ML服务将在 `http://your-server:8080` 提供API服务！ 