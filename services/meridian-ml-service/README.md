# Meridian ML Service

AI驱动的智能聚类分析服务，专为Meridian项目设计，提供嵌入生成和聚类分析功能。

## 🌟 主要特性

- **嵌入生成**: 使用 `intfloat/multilingual-e5-small` 模型生成多语言文本嵌入
- **智能聚类**: UMAP降维 + HDBSCAN聚类算法
- **AI Worker集成**: 完美兼容Meridian后端的数据格式
- **生产就绪**: Docker容器化，支持健康检查和监控
- **可扩展**: 支持多种部署方式和自定义配置

## 🚀 快速开始

### 本地开发

1. **安装依赖**:
```bash
cd services/meridian-ml-service
pip install -e .
```

2. **启动服务**:
```bash
./start_local.sh
```

3. **测试服务**:
```bash
curl http://localhost:8081/health
```

### Docker部署

#### 方式1: 使用docker-compose（推荐）

```bash
# 开发环境
docker-compose up -d

# 生产环境（不挂载源代码）
docker-compose --profile production up -d
```

#### 方式2: 直接Docker运行

```bash
# 构建镜像
docker build -t meridian-ml-service:latest .

# 运行容器
docker run -d \
  --name meridian-ml-service \
  -p 8081:8080 \
  -e API_TOKEN=your-secure-token \
  -e EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-small \
  meridian-ml-service:latest
```

## 🛠️ 构建和部署

### 1. 本地构建

```bash
# 仅构建镜像
./build-and-push-multiarch.sh --build-only

# 构建并推送到Docker Hub
./build-and-push-multiarch.sh --push --user your-dockerhub-username

# 多架构构建
./build-and-push-multiarch.sh --platform linux/amd64,linux/arm64 --push
```

### 2. VPS部署

#### 简单部署
```bash
# 部署到VPS（自动生成API令牌）
./deploy-to-vps.sh --host user@your-vps-ip

# 使用自定义镜像和令牌
./deploy-to-vps.sh --host user@your-vps-ip \
  --image your-dockerhub-user/meridian-ml-service \
  --token your-api-token
```

#### 生产环境部署（带SSL和监控）
```bash
# 完整生产环境部署
./deploy-to-vps.sh --host user@your-vps-ip \
  --domain api.yourdomain.com \
  --monitoring
```

这将自动配置：
- ✅ SSL证书（Let's Encrypt）
- ✅ Nginx反向代理
- ✅ Prometheus监控
- ✅ Grafana仪表板
- ✅ 自动重启和健康检查

## 📋 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `API_TOKEN` | API访问令牌 | 必需设置 |
| `EMBEDDING_MODEL_NAME` | 嵌入模型名称 | `intfloat/multilingual-e5-small` |
| `LOG_LEVEL` | 日志级别 | `INFO` |
| `PYTHONUNBUFFERED` | Python输出缓冲 | `1` |

## 🔧 API接口

### 核心端点

- `GET /` - 服务信息
- `GET /health` - 健康检查
- `POST /embeddings` - 生成文本嵌入
- `POST /ai-worker/clustering` - AI Worker格式聚类
- `POST /clustering/auto` - 自动检测格式聚类

### 示例请求

#### 嵌入生成
```bash
curl -X POST "http://localhost:8081/embeddings" \
  -H "Authorization: Bearer your-api-token" \
  -H "Content-Type: application/json" \
  -d '{
    "texts": ["Hello world", "你好世界"],
    "normalize": true
  }'
```

#### AI Worker聚类
```bash
curl -X POST "http://localhost:8081/ai-worker/clustering" \
  -H "Authorization: Bearer your-api-token" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": 1,
      "embedding": [0.1, 0.2, ..., 0.384],
      "title": "文章标题"
    }
  ]'
```

## 🏗️ 架构设计

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Meridian      │    │   ML Service    │    │   Models        │
│   Backend       │────│   FastAPI       │────│   E5-Small      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                       ┌─────────────────┐
                       │   Clustering    │
                       │   UMAP+HDBSCAN  │
                       └─────────────────┘
```

### 技术栈

- **Web框架**: FastAPI + Uvicorn
- **AI模型**: Transformers + PyTorch
- **聚类算法**: UMAP + HDBSCAN + scikit-learn
- **容器化**: Docker + Docker Compose
- **反向代理**: Nginx (生产环境)
- **监控**: Prometheus + Grafana (可选)

## 🔍 监控和运维

### 健康检查

```bash
# 本地检查
curl http://localhost:8081/health

# VPS检查
curl http://your-vps-ip:8080/health
```

### 查看日志

```bash
# Docker Compose
docker-compose logs -f ml-service

# 单个容器
docker logs meridian-ml-service -f
```

### 性能监控

如果启用了监控，可以访问：
- **Grafana**: `http://your-vps-ip:3000` (admin/admin123)
- **Prometheus**: `http://your-vps-ip:9090`

## 🛡️ 安全配置

### 生产环境检查清单

- [ ] 设置强密码的API令牌
- [ ] 配置SSL证书（HTTPS）
- [ ] 启用防火墙规则
- [ ] 定期更新依赖包
- [ ] 配置日志轮转
- [ ] 设置资源限制

### 推荐配置

```bash
# 生成安全的API令牌
openssl rand -hex 32

# 设置防火墙（Ubuntu/Debian）
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

## 🚨 故障排查

### 常见问题

1. **镜像构建失败**
   ```bash
   # 检查Docker版本
   docker --version
   
   # 清理缓存重新构建
   docker system prune -a
   ./build-and-push-multiarch.sh --build-only
   ```

2. **健康检查失败**
   ```bash
   # 查看容器日志
   docker logs meridian-ml-service --tail 50
   
   # 检查端口占用
   netstat -tulpn | grep :8080
   ```

3. **VPS部署失败**
   ```bash
   # 检查SSH连接
   ssh user@your-vps-ip "docker --version"
   
   # 手动部署
   scp docker-compose.yml user@your-vps-ip:~/
   ssh user@your-vps-ip "cd ~ && docker-compose up -d"
   ```

### 性能优化

- **内存**: 建议至少2GB RAM
- **CPU**: 至少1核心，建议2核心以上
- **存储**: 至少10GB可用空间
- **网络**: 稳定的互联网连接（用于下载模型）

## 📚 API文档

部署后访问以下地址查看完整API文档：

- **Swagger UI**: `http://your-host:8080/docs`
- **ReDoc**: `http://your-host:8080/redoc`

## 🤝 开发贡献

### 开发环境设置

```bash
# 克隆项目
git clone <repository-url>
cd meridian/services/meridian-ml-service

# 安装开发依赖
pip install -e ".[dev]"

# 运行测试
pytest

# 代码格式化
ruff format .
ruff check .
```

### 项目结构

```
src/
├── main.py              # FastAPI应用入口
├── pipeline.py          # 聚类处理管道
├── clustering.py        # 聚类算法实现
├── embeddings.py        # 嵌入生成
├── schemas.py           # 数据模型定义
├── config.py            # 配置管理
└── dependencies.py      # 依赖注入
```

## 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](../../LICENSE) 文件。

## 🆘 获取帮助

- **文档**: 查看 `docs/` 目录
- **问题**: 在 GitHub Issues 中提交
- **讨论**: 参与 GitHub Discussions

---

**Meridian ML Service** - 让AI智能聚类变得简单高效 🚀 