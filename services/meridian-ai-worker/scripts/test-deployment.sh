#!/bin/bash

# Meridian AI Worker 部署测试脚本
# 用于验证部署后的服务功能

# 设置颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 默认测试 URL（可以通过环境变量覆盖）
BASE_URL=${MERIDIAN_AI_WORKER_URL:-"http://localhost:8787"}

echo "🧪 开始测试 Meridian AI Worker 部署..."
echo "📍 测试 URL: $BASE_URL"
echo ""

# 测试健康检查端点
echo "1️⃣ 测试健康检查端点..."
if curl -s -f "$BASE_URL/health" > /dev/null; then
    echo -e "${GREEN}✅ 健康检查端点正常${NC}"
    HEALTH_DATA=$(curl -s "$BASE_URL/health")
    echo "   状态: $(echo $HEALTH_DATA | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"
    echo "   服务: $(echo $HEALTH_DATA | grep -o '"service":"[^"]*"' | cut -d'"' -f4)"
    echo "   版本: $(echo $HEALTH_DATA | grep -o '"version":"[^"]*"' | cut -d'"' -f4)"
else
    echo -e "${RED}❌ 健康检查端点失败${NC}"
    exit 1
fi

echo ""

# 测试 AI Gateway 配置验证端点
echo "2️⃣ 测试 AI Gateway 配置验证..."
if curl -s -f "$BASE_URL/ai-gateway/config" > /dev/null; then
    echo -e "${GREEN}✅ AI Gateway 配置端点正常${NC}"
    CONFIG_DATA=$(curl -s "$BASE_URL/ai-gateway/config")
    
    # 检查基础配置
    ACCOUNT_ID=$(echo $CONFIG_DATA | grep -o '"account_id":[^,}]*' | cut -d':' -f2)
    GATEWAY_ID=$(echo $CONFIG_DATA | grep -o '"gateway_id":[^,}]*' | cut -d':' -f2)
    API_TOKEN=$(echo $CONFIG_DATA | grep -o '"api_token":[^,}]*' | cut -d':' -f2)
    
    if [[ "$ACCOUNT_ID" == "true" && "$GATEWAY_ID" == "true" && "$API_TOKEN" == "true" ]]; then
        echo -e "${GREEN}   ✅ AI Gateway 基础配置完整${NC}"
    else
        echo -e "${YELLOW}   ⚠️ AI Gateway 基础配置不完整${NC}"
        echo "      Account ID: $ACCOUNT_ID"
        echo "      Gateway ID: $GATEWAY_ID"
        echo "      API Token: $API_TOKEN"
    fi
else
    echo -e "${RED}❌ AI Gateway 配置端点失败${NC}"
    exit 1
fi

echo ""

# 测试提供商列表端点
echo "3️⃣ 测试提供商列表..."
if curl -s -f "$BASE_URL/providers" > /dev/null; then
    echo -e "${GREEN}✅ 提供商列表端点正常${NC}"
    PROVIDERS_DATA=$(curl -s "$BASE_URL/providers")
    PROVIDER_COUNT=$(echo $PROVIDERS_DATA | grep -o '"total":[0-9]*' | cut -d':' -f2)
    echo "   可用提供商数量: $PROVIDER_COUNT"
else
    echo -e "${RED}❌ 提供商列表端点失败${NC}"
    exit 1
fi

echo ""

# 测试能力端点
echo "4️⃣ 测试能力端点..."
for capability in "chat" "embedding" "image"; do
    if curl -s -f "$BASE_URL/capabilities/$capability/providers" > /dev/null; then
        CAPABILITY_DATA=$(curl -s "$BASE_URL/capabilities/$capability/providers")
        COUNT=$(echo $CAPABILITY_DATA | grep -o '"count":[0-9]*' | cut -d':' -f2)
        echo -e "${GREEN}   ✅ $capability 能力支持，提供商数量: $COUNT${NC}"
    else
        echo -e "${YELLOW}   ⚠️ $capability 能力端点无响应${NC}"
    fi
done

echo ""

# 测试 AI 功能（需要配置）
echo "5️⃣ 测试 AI 功能..."
if curl -s -X POST "$BASE_URL/chat" \
    -H "Content-Type: application/json" \
    -d '{"messages": [{"role": "user", "content": "Hello"}]}' > /dev/null; then
    echo -e "${GREEN}✅ AI 聊天功能正常${NC}"
else
    echo -e "${YELLOW}⚠️ AI 聊天功能需要配置或无法使用${NC}"
    echo "   这通常意味着需要设置 AI Gateway 配置或 API 密钥"
fi

echo ""

# 检查 CORS 支持
echo "6️⃣ 测试 CORS 支持..."
CORS_HEADERS=$(curl -s -I -X OPTIONS "$BASE_URL/health" | grep -i "access-control")
if [[ -n "$CORS_HEADERS" ]]; then
    echo -e "${GREEN}✅ CORS 支持已启用${NC}"
else
    echo -e "${YELLOW}⚠️ CORS 支持可能未正确配置${NC}"
fi

echo ""
echo "🎉 部署测试完成！"

# 显示部署建议
echo ""
echo "💡 部署建议："
echo "   - 如果 AI Gateway 配置不完整，请在 Cloudflare 控制台中设置"
echo "   - 如果 AI 功能无法使用，请检查环境变量配置"
echo "   - 生产环境部署前请确保所有测试都通过"
