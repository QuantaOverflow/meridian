#!/bin/bash

# Meridian ML Service - VPS部署验证脚本

set -e

# 配置
VPS_HOST="${1:-localhost}"
SERVICE_PORT="${2:-8080}"
API_TOKEN="${API_TOKEN:-${3:-5bb66405234a9a96768ce2b5fc925309c2d109c436c910a80ed19c648d4c24dd}}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔍 Meridian ML Service 部署验证${NC}"
echo "======================================"
echo "主机: $VPS_HOST"
echo "端口: $SERVICE_PORT"
echo "API Token: ${API_TOKEN:0:10}..."
echo ""

# 基础连接测试
echo -e "${YELLOW}1. 测试基础连接...${NC}"
if curl -s --connect-timeout 5 "http://$VPS_HOST:$SERVICE_PORT/" >/dev/null; then
    echo -e "${GREEN}✅ 基础连接成功${NC}"
else
    echo -e "${RED}❌ 基础连接失败${NC}"
    exit 1
fi

# 健康检查
echo -e "${YELLOW}2. 健康检查...${NC}"
health_response=$(curl -s "http://$VPS_HOST:$SERVICE_PORT/health")
if echo "$health_response" | grep -q '"status":"healthy"'; then
    echo -e "${GREEN}✅ 服务健康${NC}"
    
    # 解析健康信息
    echo "   详细信息:"
    echo "$health_response" | python3 -m json.tool 2>/dev/null | sed 's/^/     /' || echo "     $health_response"
else
    echo -e "${RED}❌ 健康检查失败${NC}"
    echo "响应: $health_response"
    exit 1
fi

# API端点测试
echo -e "${YELLOW}3. API端点测试...${NC}"

# 基础信息
echo -e "${BLUE}   3.1 基础信息端点${NC}"
base_info=$(curl -s "http://$VPS_HOST:$SERVICE_PORT/")
if echo "$base_info" | grep -q '"service"'; then
    echo -e "${GREEN}   ✅ 基础信息获取成功${NC}"
else
    echo -e "${RED}   ❌ 基础信息获取失败${NC}"
fi

# 嵌入生成测试
echo -e "${BLUE}   3.2 嵌入生成测试${NC}"
embedding_response=$(curl -s -X POST "http://$VPS_HOST:$SERVICE_PORT/embeddings" \
    -H "Content-Type: application/json" \
    -H "X-API-Token: $API_TOKEN" \
    -d '{"texts": ["测试文本", "另一个测试文本"]}')

if echo "$embedding_response" | grep -q '"embeddings"'; then
    echo -e "${GREEN}   ✅ 嵌入生成成功${NC}"
    
    # 获取嵌入维度
    dimension=$(echo "$embedding_response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    embeddings = data.get('embeddings', [])
    if embeddings:
        print(f'嵌入维度: {len(embeddings[0])}')
        print(f'嵌入数量: {len(embeddings)}')
        print(f'模型名: {data.get(\"model_name\", \"未知\")}')
    else:
        print('无嵌入数据')
except:
    print('解析失败')
" 2>/dev/null)
    echo "     $dimension"
else
    echo -e "${RED}   ❌ 嵌入生成失败${NC}"
    echo "     响应: $embedding_response"
fi

# 聚类功能测试（可选）
echo -e "${BLUE}   3.3 聚类功能测试${NC}"
clustering_response=$(curl -s -X POST "http://$VPS_HOST:$SERVICE_PORT/clustering" \
    -H "Content-Type: application/json" \
    -H "X-API-Token: $API_TOKEN" \
    -d '{
        "texts": [
            "人工智能技术发展迅速",
            "机器学习在各行业应用广泛", 
            "深度学习模型性能提升",
            "比特币价格持续波动",
            "数字货币市场分析",
            "区块链技术应用前景"
        ],
        "config": {
            "umap_n_components": 3,
            "umap_n_neighbors": 3,
            "hdbscan_min_cluster_size": 2
        }
    }')

if echo "$clustering_response" | grep -q '"clustering_stats"'; then
    echo -e "${GREEN}   ✅ 聚类功能正常${NC}"
    
    # 解析聚类结果
    stats=$(echo "$clustering_response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    stats = data.get('clustering_stats', {})
    print(f'   簇数量: {stats.get(\"n_clusters\", 0)}')
    print(f'   异常点: {stats.get(\"n_outliers\", 0)}')
    print(f'   DBCV分数: {stats.get(\"dbcv_score\", \"N/A\")}')
except:
    print('   解析失败')
" 2>/dev/null)
    echo "$stats"
else
    echo -e "${YELLOW}   ⚠️  聚类功能可能未启用或出错${NC}"
    echo "     响应: ${clustering_response:0:200}..."
fi

# 容器状态检查（如果在VPS上运行）
if [ "$VPS_HOST" = "localhost" ] && command -v docker >/dev/null; then
    echo -e "${YELLOW}4. 容器状态检查...${NC}"
    
    container_status=$(docker ps --filter name=meridian-ml-service --format "{{.Status}}")
    if [ -n "$container_status" ]; then
        echo -e "${GREEN}✅ 容器运行状态: $container_status${NC}"
        
        # 资源使用情况
        echo -e "${BLUE}   资源使用:${NC}"
        docker stats --no-stream --format "     CPU: {{.CPUPerc}}  内存: {{.MemUsage}}" meridian-ml-service 2>/dev/null || echo "     获取失败"
        
        # 最近日志
        echo -e "${BLUE}   最近日志 (最后5行):${NC}"
        docker logs --tail 5 meridian-ml-service 2>/dev/null | sed 's/^/     /' || echo "     日志获取失败"
    else
        echo -e "${RED}❌ 未找到meridian-ml-service容器${NC}"
    fi
fi

echo ""
echo -e "${GREEN}🎉 部署验证完成!${NC}"
echo ""
echo -e "${BLUE}📝 管理建议:${NC}"
echo "   • 监控地址: http://$VPS_HOST:$SERVICE_PORT/health"
echo "   • API文档: http://$VPS_HOST:$SERVICE_PORT/docs"
echo "   • 日志查看: docker logs -f meridian-ml-service"
echo "   • 重启服务: docker restart meridian-ml-service"
echo "" 