# Meridian ML Service - Docker 部署指南

## 📋 概述

本指南介绍如何将 Meridian ML Service 打包为 Docker 镜像并部署到 VPS 服务器。

## 🛠️ 功能特性

- **嵌入生成**: 使用 `multilingual-e5-small` 模型生成384维文本嵌入
- **智能文本聚类**: UMAP降维 + HDBSCAN聚类算法
- **参数自动优化**: 基于DBCV的网格搜索最佳参数
- **API认证**: Bearer Token身份验证
- **健康监控**: 详细的健康检查端点
- **容器化**: 完整的 Docker 支持

## 🏗️ 架构特点

### 多阶段构建
- **依赖阶段**: 安装Python依赖和ML模型
- **生产阶段**: 精简的运行时环境
- **模型预加载**: 构建时下载模型，避免运行时下载

### 安全特性
- 非root用户运行
- 最小化基础镜像
- 安全的环境变量处理

### 性能优化
- CPU版本PyTorch (适合VPS部署)
- 模型缓存和预加载
- 多进程支持

## 📦 构建和推送到 Docker Hub

### 1. 准备工作

确保在 `services/meridian-ml-service` 目录下：

```bash
cd services/meridian-ml-service
```

### 2. 使用自动化脚本构建

```bash
# 给脚本执行权限
chmod +x build-and-push.sh

# 运行构建脚本
./build-and-push.sh
```

脚本会引导您：
1. 设置 Docker Hub 用户名
2. 选择镜像版本
3. 构建镜像
4. 测试镜像功能
5. 推送到 Docker Hub

### 3. 手动构建（可选）

```bash
# 构建镜像
docker build -f Dockerfile.production -t your-username/meridian-ml-service:latest .

# 推送到 Docker Hub
docker login
docker push your-username/meridian-ml-service:latest
```

## 🚀 VPS 部署

### 方式一：自动化部署脚本

1. 将部署脚本复制到VPS：

```bash
# 在本地
scp deploy-vps.sh user@your-vps:/tmp/

# 在VPS上
ssh user@your-vps
cd /tmp
chmod +x deploy-vps.sh
./deploy-vps.sh
```

2. 按提示配置：
   - Docker Hub 用户名
   - 镜像版本
   - 服务端口
   - API Token

### 方式二：手动部署

1. **安装 Docker**：

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

2. **拉取镜像**：

```bash
docker pull your-username/meridian-ml-service:latest
```

3. **运行容器**：

```bash
docker run -d \
  --name meridian-ml-service \
  --restart unless-stopped \
  -p 8080:8080 \
  -e API_TOKEN=your-secret-token \
  -e PYTHONUNBUFFERED=1 \
  your-username/meridian-ml-service:latest
```

### 方式三：Docker Compose 部署

1. 创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  meridian-ml-service:
    image: your-username/meridian-ml-service:latest
    container_name: meridian-ml-service
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - API_TOKEN=your-secret-token
      - PYTHONUNBUFFERED=1
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start-period: 60s
```

2. 启动服务：

```bash
docker-compose up -d
```

## 🔧 配置说明

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `API_TOKEN` | 无 | API认证令牌（必需） |
| `EMBEDDING_MODEL_NAME` | `/home/appuser/app/models` | 模型路径 |
| `PYTHONUNBUFFERED` | `1` | Python输出缓冲 |

### 端口配置

- **容器内端口**: 8080
- **映射端口**: 可自定义（默认8080）

### 资源要求

- **内存**: 最少1GB，推荐2GB
- **CPU**: 1核心即可，推荐2核心
- **存储**: 约2GB（包含模型）

## 🔍 验证部署

### 1. 健康检查

```bash
curl http://localhost:8080/health
```

期望响应：
```json
{
  "status": "healthy",
  "embedding_model": "/home/appuser/app/models",
  "clustering_available": true,
  "optimization_available": true,
  "timestamp": 1703097600.0
}
```

### 2. API测试

```bash
# 基础信息
curl http://localhost:8080/

# 嵌入生成测试
curl -X POST http://localhost:8080/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"texts": ["测试文本"]}'
```

### 3. 聚类测试

```bash
curl -X POST http://localhost:8080/clustering \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"texts": ["文本1", "文本2", "文本3"]}'
```

## 📊 监控和日志

### 查看日志

```bash
# 实时日志
docker logs -f meridian-ml-service

# 最近日志
docker logs --tail 100 meridian-ml-service
```

### 监控资源

```bash
# 资源使用情况
docker stats meridian-ml-service

# 容器状态
docker ps | grep meridian-ml-service
```

## 🛡️ 安全建议

### 1. API Token

使用强随机Token：
```bash
# 生成随机token
openssl rand -hex 32
```

### 2. 反向代理

使用Nginx添加HTTPS：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 3. 防火墙

```bash
# 仅允许必要端口
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

## 🔄 更新和维护

### 更新镜像

```bash
# 拉取新版本
docker pull your-username/meridian-ml-service:latest

# 停止旧容器
docker stop meridian-ml-service
docker rm meridian-ml-service

# 启动新容器
docker run -d \
  --name meridian-ml-service \
  --restart unless-stopped \
  -p 8080:8080 \
  -e API_TOKEN=your-secret-token \
  your-username/meridian-ml-service:latest
```

### 备份配置

```bash
# 备份环境变量
docker inspect meridian-ml-service | jq '.[0].Config.Env' > env-backup.json

# 备份容器配置
docker inspect meridian-ml-service > container-backup.json
```

## ❗ 故障排查

### 常见问题

1. **容器启动失败**
   ```bash
   docker logs meridian-ml-service
   ```

2. **内存不足**
   ```bash
   # 检查系统资源
   free -h
   docker stats
   ```

3. **模型加载失败**
   ```bash
   # 检查模型文件
   docker exec meridian-ml-service ls -la /home/appuser/app/models
   ```

4. **API Token问题**
   ```bash
   # 检查环境变量
   docker exec meridian-ml-service env | grep API_TOKEN
   ```

### 重新部署

```bash
# 完全清理并重新部署
docker stop meridian-ml-service
docker rm meridian-ml-service
docker rmi your-username/meridian-ml-service:latest
docker pull your-username/meridian-ml-service:latest
# 重新运行容器...
```

## 📋 生产环境检查清单

- [ ] 设置强随机API Token
- [ ] 配置HTTPS反向代理
- [ ] 设置防火墙规则
- [ ] 配置系统资源监控
- [ ] 设置日志轮转
- [ ] 配置自动备份
- [ ] 测试故障恢复流程
- [ ] 文档化运维流程

## 📞 支持和反馈

如遇问题，请检查：
1. Docker日志
2. 系统资源
3. 网络连接
4. API认证配置

更多技术支持请参考项目文档或提交Issue。 