#!/bin/bash

# Meridian AI Worker 集成测试脚本
# 测试所有端点和 AI Gateway 增强功能

BASE_URL="http://localhost:8787"

echo "🚀 开始 Meridian AI Worker 集成测试"
echo ""

# 测试函数
test_endpoint() {
    local name="$1"
    local path="$2"
    local method="${3:-GET}"
    local data="$4"
    
    echo "📋 测试: $name"
    
    if [ "$method" = "POST" ] && [ -n "$data" ]; then
        response=$(curl -s -w "HTTPSTATUS:%{http_code}" -X POST "$BASE_URL$path" \
            -H "Content-Type: application/json" \
            -d "$data")
    else
        response=$(curl -s -w "HTTPSTATUS:%{http_code}" "$BASE_URL$path")
    fi
    
    http_status=$(echo $response | tr -d '\n' | sed -e 's/.*HTTPSTATUS://')
    body=$(echo $response | sed -e 's/HTTPSTATUS\:.*//g')
    
    echo "   HTTP 状态: $http_status"
    echo "   响应: ${body:0:100}..."
    
    if [ "$http_status" = "200" ]; then
        echo "   ✅ 通过"
    elif [ "$http_status" = "500" ] && [ "$name" = "聊天请求 (预期失败)" ]; then
        echo "   ✅ 按预期失败 (缺少 AI Gateway 凭据)"
    else
        echo "   ❌ 状态码: $http_status"
    fi
    echo ""
}

# 检查服务器是否运行
echo "🔍 检查服务器连接..."
if ! curl -s "$BASE_URL/health" > /dev/null; then
    echo "❌ 无法连接到服务器。请确保运行: npm run dev"
    echo "   服务器应在 http://localhost:8787 运行"
    exit 1
fi
echo "✅ 服务器连接正常"
echo ""

# 运行测试
test_endpoint "健康检查" "/health"
test_endpoint "AI Gateway 配置验证" "/ai-gateway/config"
test_endpoint "提供商列表" "/providers"
test_endpoint "聊天能力提供商" "/capabilities/chat/providers"
test_endpoint "嵌入能力提供商" "/capabilities/embedding/providers"
test_endpoint "图像能力提供商" "/capabilities/image/providers"
test_endpoint "聊天请求 (预期失败)" "/chat" "POST" '{"messages": [{"role": "user", "content": "Hello test"}], "provider": "mock"}'

echo "📊 测试完成！"
echo ""
echo "🔧 查看 AI Gateway 增强功能状态:"
health_response=$(curl -s "$BASE_URL/health")
echo "$health_response" | python3 -m json.tool 2>/dev/null || echo "$health_response"
echo ""
echo "📚 要启用 AI Gateway 增强功能，请配置以下环境变量:"
echo "   - CLOUDFLARE_ACCOUNT_ID"
echo "   - CLOUDFLARE_GATEWAY_ID" 
echo "   - CLOUDFLARE_API_TOKEN"
echo "   - AI_GATEWAY_AUTH_TOKEN (可选)"
echo "   - AI_GATEWAY_ENABLE_COST_TRACKING=true (可选)"
echo "   - AI_GATEWAY_ENABLE_CACHING=true (可选)"
echo "   - AI_GATEWAY_ENABLE_METRICS=true (可选)"
echo "   - AI_GATEWAY_ENABLE_LOGGING=true (可选)"
