# Meridian ML Service Docker 部署指南

## 概述

本指南介绍如何构建、推送和部署 Meridian ML Service 的 Docker 镜像。

## 文件说明

- `Dockerfile` - Docker 镜像构建文件
- `docker-compose.yml` - 本地开发和测试配置
- `build-and-push.sh` - 构建和推送脚本
- `deploy-vps.sh` - VPS 部署脚本

## 快速开始

### 1. 本地构建

仅在本地构建镜像：

```bash
./build-and-push.sh --build-only
```

### 2. 构建并推送到 Docker Hub

```bash
# 设置 Docker Hub 用户名
export DOCKER_HUB_USER=your-username

# 构建并推送
./build-and-push.sh --push --user your-username
```

### 3. 在 VPS 上部署

将脚本复制到 VPS 并运行：

```bash
# 在 VPS 上
./deploy-vps.sh --user your-username
```

## 详细使用说明

### 构建脚本 (build-and-push.sh)

#### 选项

- `--build-only` - 仅构建，不推送
- `--push` - 构建并推送到镜像仓库
- `--user <username>` - Docker Hub 用户名
- `--registry <url>` - 镜像仓库地址 (默认: docker.io)
- `--platform <platform>` - 目标平台 (默认: linux/amd64)
- `--clean` - 构建前清理相关镜像
- `--no-cache` - 不使用缓存构建
- `--help` - 显示帮助信息

#### 示例

```bash
# 仅本地构建
./build-and-push.sh --build-only

# 构建并推送（需要先登录 Docker Hub）
./build-and-push.sh --push --user myuser

# 清理后重新构建并推送
./build-and-push.sh --push --user myuser --clean --no-cache

# 多架构构建
./build-and-push.sh --push --user myuser --platform linux/amd64,linux/arm64
```

### VPS 部署脚本 (deploy-vps.sh)

#### 选项

- `--user <username>` - Docker Hub 用户名
- `--registry <url>` - 镜像仓库地址 (默认: docker.io)
- `--port <port>` - 服务端口 (默认: 8080)
- `--version <version>` - 镜像版本 (默认: 0.3.0)
- `--help` - 显示帮助信息

#### 环境变量

- `DOCKER_HUB_USER` - Docker Hub 用户名
- `REGISTRY` - 镜像仓库地址
- `PORT` - 服务端口
- `API_TOKEN` - API 访问令牌（如未设置将自动生成）

#### 示例

```bash
# 基本部署
./deploy-vps.sh --user myuser

# 部署到指定端口
./deploy-vps.sh --user myuser --port 8081

# 使用环境变量
export DOCKER_HUB_USER=myuser
export API_TOKEN=my-secret-token
./deploy-vps.sh
```

### Docker Compose

用于本地开发和测试：

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 启动生产环境（包含 nginx）
docker-compose --profile production up -d
```

## 完整部署流程

### 1. 本地开发

```bash
# 启动本地开发环境
docker-compose up -d

# 测试服务
curl http://localhost:8080/health
```

### 2. 构建和推送

```bash
# 登录 Docker Hub
docker login

# 构建并推送
./build-and-push.sh --push --user your-username
```

### 3. VPS 部署

```bash
# 将部署脚本复制到 VPS
scp deploy-vps.sh user@your-vps:/tmp/

# 在 VPS 上执行部署
ssh user@your-vps
cd /tmp
chmod +x deploy-vps.sh
./deploy-vps.sh --user your-username
```

## 故障排查

### 构建失败

1. 检查 Docker 是否运行
2. 确认网络连接正常
3. 查看构建日志中的错误信息

### 推送失败

1. 确认已登录 Docker Hub: `docker login`
2. 检查用户名是否正确
3. 确认有推送权限

### 部署失败

1. 检查镜像是否存在: `docker pull image-name`
2. 查看容器日志: `docker logs meridian-ml-service`
3. 检查端口是否被占用: `netstat -tlnp | grep 8080`

### 健康检查失败

1. 等待更长时间（模型下载需要时间）
2. 检查内存是否足够（建议至少 2GB）
3. 查看容器日志了解具体错误

## 注意事项

1. **内存要求**: 服务需要至少 2GB 内存来加载 ML 模型
2. **网络要求**: 首次启动需要下载模型，确保网络连接稳定
3. **存储要求**: 模型缓存需要约 500MB 存储空间
4. **安全性**: 生产环境请设置强密码的 API_TOKEN

## 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `API_TOKEN` | API 访问令牌 | 自动生成 |
| `EMBEDDING_MODEL_NAME` | 嵌入模型名称 | `intfloat/multilingual-e5-small` |
| `LOG_LEVEL` | 日志级别 | `INFO` |
| `PYTHONUNBUFFERED` | Python 输出缓冲 | `1` |

## 支持

如有问题，请查看：
1. 容器日志: `docker logs meridian-ml-service`
2. 系统资源: `docker stats`
3. 网络连接: `curl http://localhost:8080/health` 