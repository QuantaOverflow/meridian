#!/bin/bash

echo "🔍 直接测试 Cloudflare AI Gateway API"
echo "==================================="

# 从 wrangler secrets 获取配置信息
echo "1. 当前环境变量："
wrangler secret list | grep -E "(CLOUDFLARE|GATEWAY)"

echo -e "\n2. 请手动输入从 Dashboard 获取的信息："
read -p "Account ID: " ACCOUNT_ID
read -p "Gateway ID: " GATEWAY_ID
read -p "API Token: " API_TOKEN
echo

# 3. 测试 API Token 权限
echo -e "\n3. 测试 API Token 权限："
auth_test=$(curl -s -w "HTTPSTATUS:%{http_code}" \
  -X GET "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json")

auth_code=$(echo $auth_test | sed -e 's/.*HTTPSTATUS://')
auth_body=$(echo $auth_test | sed -e 's/HTTPSTATUS\:.*//g')

echo "   HTTP 状态码: $auth_code"
if [[ "$auth_code" == "200" ]]; then
    echo "   ✅ API Token 有效"
    account_name=$(echo "$auth_body" | jq -r '.result.name // "N/A"')
    echo "   账户名: $account_name"
else
    echo "   ❌ API Token 无效或权限不足"
    echo "   错误: $auth_body"
    exit 1
fi

# 4. 检查 AI Gateway 是否存在
echo -e "\n4. 检查 AI Gateway 是否存在："
gateway_test=$(curl -s -w "HTTPSTATUS:%{http_code}" \
  -X GET "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/gateways" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json")

gateway_code=$(echo $gateway_test | sed -e 's/.*HTTPSTATUS://')
gateway_body=$(echo $gateway_test | sed -e 's/HTTPSTATUS\:.*//g')

echo "   HTTP 状态码: $gateway_code"
if [[ "$gateway_code" == "200" ]]; then
    echo "   ✅ 成功获取 Gateway 列表"
    gateway_names=$(echo "$gateway_body" | jq -r '.result[].name // "N/A"' | tr '\n' ', ')
    echo "   现有 Gateways: $gateway_names"
    
    # 检查指定的 Gateway 是否存在
    gateway_exists=$(echo "$gateway_body" | jq --arg id "$GATEWAY_ID" '.result[] | select(.id == $id) | .id')
    if [[ -n "$gateway_exists" ]]; then
        echo "   ✅ Gateway '$GATEWAY_ID' 存在"
    else
        echo "   ❌ Gateway '$GATEWAY_ID' 不存在"
        echo "   可用的 Gateway IDs:"
        echo "$gateway_body" | jq -r '.result[] | "   - \(.id)"'
    fi
else
    echo "   ❌ 无法获取 Gateway 列表"
    echo "   错误: $gateway_body"
fi

# 5. 如果配置正确，更新环境变量
if [[ "$auth_code" == "200" && "$gateway_code" == "200" && -n "$gateway_exists" ]]; then
    echo -e "\n5. 更新 Worker 环境变量："
    echo "wrangler secret put CLOUDFLARE_ACCOUNT_ID"
    echo "$ACCOUNT_ID" | wrangler secret put CLOUDFLARE_ACCOUNT_ID
    
    echo "wrangler secret put CLOUDFLARE_GATEWAY_ID"  
    echo "$GATEWAY_ID" | wrangler secret put CLOUDFLARE_GATEWAY_ID
    
    echo "wrangler secret put CLOUDFLARE_API_TOKEN"
    echo "$API_TOKEN" | wrangler secret put CLOUDFLARE_API_TOKEN
    
    echo "   ✅ 环境变量已更新"
    
    # 6. 重新部署并测试
    echo -e "\n6. 重新部署 Worker："
    wrangler deploy
    
    echo -e "\n7. 等待部署完成并测试："
    sleep 10
    
    test_response=$(curl -s -w "HTTPSTATUS:%{http_code}" \
      -X POST "https://meridian-ai-worker.swj299792458.workers.dev/ai" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer j+96PlDDJPVI7dAhoxdWfgynQTxqEzf5vnea6wrhKXg=" \
      -d '{
        "capability": "chat",
        "messages": [{"role": "user", "content": "Hello"}],
        "provider": "workers-ai",
        "model": "@cf/meta/llama-2-7b-chat-int8"
      }')
    
    test_code=$(echo $test_response | sed -e 's/.*HTTPSTATUS://')
    test_body=$(echo $test_response | sed -e 's/HTTPSTATUS\:.*//g')
    
    echo "   HTTP 状态码: $test_code"
    if [[ "$test_code" == "200" ]]; then
        echo "   ✅ Worker 测试成功！"
        echo "   响应: $(echo "$test_body" | jq -r '.choices[0].message.content // "解析失败"' 2>/dev/null || echo "解析失败")"
    else
        echo "   ❌ Worker 测试失败"
        echo "   错误: $test_body"
    fi
else
    echo -e "\n❌ 配置验证失败，请检查 Cloudflare Dashboard 中的 AI Gateway 设置"
fi

echo -e "\n=== 测试完成 ==="
