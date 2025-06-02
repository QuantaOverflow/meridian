# 🚀 Meridian ML Service VPS 部署完整指南

## 📋 前置准备

### **镜像信息**
- **镜像名称**: `crossovo/meridian-ml-service:0.3.0`
- **镜像大小**: 2.8GB
- **架构**: Linux/amd64
- **运行端口**: 8080

### **VPS最低要求**
- **内存**: 最少2GB，推荐4GB
- **CPU**: 1核心，推荐2核心
- **存储**: 最少5GB可用空间
- **操作系统**: Ubuntu 20.04+ / CentOS 7+ / Debian 10+

---

## 🛠️ 方案选择

### **方案1：自动化脚本部署（推荐新手）**

**步骤1**: 传输部署脚本到VPS
```bash
# 本地执行
scp deploy-vps.sh user@your-vps-ip:/tmp/
```

**步骤2**: SSH登录VPS并执行
```bash
ssh user@your-vps-ip
cd /tmp
chmod +x deploy-vps.sh
./deploy-vps.sh
```

**特点**:
- ✅ 自动安装Docker
- ✅ 交互式配置
- ✅ 自动健康检查
- ✅ 完整的错误处理

---

### **方案2：Docker Compose部署（推荐生产）**

**步骤1**: 传输配置文件
```bash
# 本地执行
scp docker-compose.vps.yml user@your-vps-ip:/opt/meridian/
```

**步骤2**: VPS上配置和启动
```bash
ssh user@your-vps-ip

# 创建目录
sudo mkdir -p /opt/meridian
cd /opt/meridian

# 创建环境变量文件
sudo tee .env << EOF
API_TOKEN=your-super-secure-token-here-$(date +%s)
WORKERS=1
MAX_WORKERS=4
TIMEOUT=300
EOF

# 安装docker-compose（如果需要）
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 启动服务
sudo docker-compose -f docker-compose.vps.yml up -d
```

**特点**:
- ✅ 声明式配置
- ✅ 资源限制
- ✅ 自动重启
- ✅ 健康检查
- ✅ 日志轮转

---

### **方案3：手动Docker部署（快速测试）**

```bash
# 1. 安装Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker

# 2. 运行容器
docker run -d \
  --name meridian-ml-service \
  --restart unless-stopped \
  -p 8080:8080 \
  -e API_TOKEN="$(openssl rand -hex 32)" \
  -e PYTHONUNBUFFERED=1 \
  --memory="2g" \
  --cpus="1.0" \
  crossovo/meridian-ml-service:0.3.0
```

---

## 🔍 部署验证

### **自动化验证（推荐）**

```bash
# 传输验证脚本
scp verify-deployment.sh user@your-vps-ip:/tmp/

# 在VPS上执行验证
ssh user@your-vps-ip
chmod +x /tmp/verify-deployment.sh
/tmp/verify-deployment.sh localhost 8080 your-api-token
```

### **手动验证**

```bash
# 1. 基础连接测试
curl http://your-vps-ip:8080/

# 2. 健康检查
curl http://your-vps-ip:8080/health

# 3. API功能测试
curl -X POST http://your-vps-ip:8080/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-token" \
  -d '{"texts": ["测试文本"]}'
```

**期望响应**:
```json
{
  "embeddings": [[0.1, 0.2, ...]], // 384维向量
  "model_name": "/home/appuser/app/models",
  "processing_time": 0.156
}
```

---

## 🔧 生产环境配置

### **反向代理配置（Nginx）**

```nginx
# /etc/nginx/sites-available/meridian-ml
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 增加超时时间
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

### **SSL证书配置（Let's Encrypt）**

```bash
# 安装certbot
sudo apt install certbot python3-certbot-nginx

# 获取SSL证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo crontab -e
# 添加: 0 12 * * * /usr/bin/certbot renew --quiet
```

### **防火墙配置**

```bash
# Ubuntu/Debian
sudo ufw allow 22      # SSH
sudo ufw allow 80      # HTTP
sudo ufw allow 443     # HTTPS
sudo ufw allow 8080    # 直接访问（可选）
sudo ufw enable

# CentOS/RHEL
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --reload
```

---

## 📊 监控和维护

### **日志管理**

```bash
# 查看实时日志
docker logs -f meridian-ml-service

# 查看最近日志
docker logs --tail 100 meridian-ml-service

# 日志文件位置
/var/lib/docker/containers/$(docker inspect --format='{{.Id}}' meridian-ml-service)/$(docker inspect --format='{{.Id}}' meridian-ml-service)-json.log
```

### **性能监控**

```bash
# 容器资源使用
docker stats meridian-ml-service

# 系统资源监控
htop
iotop
```

### **备份和恢复**

```bash
# 导出容器配置
docker inspect meridian-ml-service > meridian-config-backup.json

# 备份重要数据
tar -czf meridian-backup-$(date +%Y%m%d).tar.gz /opt/meridian/

# 更新服务
docker pull crossovo/meridian-ml-service:latest
docker stop meridian-ml-service
docker rm meridian-ml-service
# 重新运行部署命令
```

---

## 🚨 故障排查

### **常见问题**

| 问题 | 症状 | 解决方案 |
|------|------|----------|
| 容器启动失败 | `docker ps`无容器 | 检查内存是否足够（最少2GB） |
| 健康检查失败 | 503状态码 | 等待2-3分钟让模型加载完成 |
| API认证失败 | 401状态码 | 检查API_TOKEN环境变量 |
| 内存不足 | OOM错误 | 增加VPS内存或减少并发 |
| 端口冲突 | 地址占用错误 | 更改映射端口或停止占用进程 |

### **诊断命令**

```bash
# 检查容器状态
docker ps -a

# 检查容器日志
docker logs meridian-ml-service

# 检查端口占用
netstat -tlnp | grep :8080

# 检查系统资源
free -h
df -h
top
```

### **紧急重启流程**

```bash
# 1. 停止服务
docker stop meridian-ml-service

# 2. 检查系统状态
free -h && df -h

# 3. 清理临时文件（如果需要）
docker system prune -f

# 4. 重启服务
docker start meridian-ml-service

# 5. 验证恢复
curl http://localhost:8080/health
```

---

## 📞 技术支持

**部署成功指标**:
- ✅ 健康检查返回 `{"status": "healthy"}`
- ✅ 嵌入生成返回384维向量
- ✅ 聚类功能正常工作
- ✅ 容器内存使用 < 2GB
- ✅ API响应时间 < 5秒

**获取帮助**:
- 查看详细日志: `docker logs meridian-ml-service`
- 性能分析: `docker stats meridian-ml-service`
- 容器诊断: `docker exec -it meridian-ml-service /bin/bash`

**联系方式**:
- 项目仓库: [GitHub Issues](https://github.com/your-repo/meridian)
- 技术文档: [项目文档](https://docs.meridian.example.com) 