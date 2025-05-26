#!/bin/bash

ACCOUNT_ID="c8317cfcb330d45b37b00ccd7e8a9936"

echo "🔍 验证新 API Token 权限"
echo "========================"

read -s -p "请输入新创建的 API Token: " NEW_TOKEN
echo

# 1. 测试账户访问权限
echo -e "\n1. 测试账户访问权限："
account_test=$(curl -s -w "HTTPSTATUS:%{http_code}" \
  -X GET "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID" \
  -H "Authorization: Bearer $NEW_TOKEN" \
  -H "Content-Type: application/json")

account_code=$(echo $account_test | sed -e 's/.*HTTPSTATUS://')
account_body=$(echo $account_test | sed -e 's/HTTPSTATUS\:.*//g')

echo "   HTTP 状态码: $account_code"
if [[ "$account_code" == "200" ]]; then
    echo "   ✅ 账户访问权限正常"
    account_name=$(echo "$account_body" | jq -r '.result.name // "N/A"')
    echo "   账户名: $account_name"
else
    echo "   ❌ 账户访问权限失败"
    echo "   错误: $account_body"
    exit 1
fi

# 2. 测试 AI Gateway 权限
echo -e "\n2. 测试 AI Gateway 权限："
gateway_test=$(curl -s -w "HTTPSTATUS:%{http_code}" \
  -X GET "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai-gateway/gateways" \
  -H "Authorization: Bearer $NEW_TOKEN" \
  -H "Content-Type: application/json")

gateway_code=$(echo $gateway_test | sed -e 's/.*HTTPSTATUS://')
gateway_body=$(echo $gateway_test | sed -e 's/HTTPSTATUS\:.*//g')

echo "   HTTP 状态码: $gateway_code"
if [[ "$gateway_code" == "200" ]]; then
    echo "   ✅ AI Gateway 权限正常"
    
    # 检查现有 Gateways
    gateway_count=$(echo "$gateway_body" | jq '.result | length')
    echo "   现有 Gateway 数量: $gateway_count"
    
    if [[ "$gateway_count" -gt 0 ]]; then
        echo "   现有 Gateways:"
        echo "$gateway_body" | jq -r '.result[] | "   - ID: \(.id), Name: \(.name)"'
        
        # 检查 meridian-ai 是否存在
        meridian_exists=$(echo "$gateway_body" | jq -r '.result[] | select(.id == "meridian-ai") | .id')
        if [[ -n "$meridian_exists" ]]; then
            echo "   ✅ Gateway 'meridian-ai' 已存在"
            GATEWAY_EXISTS=true
        else
            echo "   ⚠️  Gateway 'meridian-ai' 不存在，将创建"
            GATEWAY_EXISTS=false
        fi
    else
        echo "   ⚠️  没有现有的 Gateways，将创建 'meridian-ai'"
        GATEWAY_EXISTS=false
    fi
else
    echo "   ❌ AI Gateway 权限失败"
    echo "   错误: $gateway_body"
    exit 1
fi

# 3. 如果 Gateway 不存在，创建它
if [[ "$GATEWAY_EXISTS" == "false" ]]; then
    echo -e "\n3. 创建 'meridian-ai' Gateway："
    create_response=$(curl -s -w "HTTPSTATUS:%{http_code}" \
      -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai-gateway/gateways" \
      -H "Authorization: Bearer $NEW_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{
        "id": "meridian-ai",
        "cache_invalidate_on_update": true,
        "cache_ttl": 3600,
        "collect_logs": true,
        "rate_limiting_interval": 60,
        "rate_limiting_limit": 1000,
        "rate_limiting_technique": "sliding"
      }')
    
    create_code=$(echo $create_response | sed -e 's/.*HTTPSTATUS://')
    create_body=$(echo $create_response | sed -e 's/HTTPSTATUS\:.*//g')
    
    echo "   HTTP 状态码: $create_code"
    if [[ "$create_code" == "201" || "$create_code" == "200" ]]; then
        echo "   ✅ Gateway 'meridian-ai' 创建成功"
    else
        echo "   ❌ Gateway 创建失败"
        echo "   错误: $create_body"
        exit 1
    fi
fi

# 4. 更新 Worker 环境变量
echo -e "\n4. 更新 Worker 环境变量："
echo "$ACCOUNT_ID" | wrangler secret put CLOUDFLARE_ACCOUNT_ID
echo "meridian-ai" | wrangler secret put CLOUDFLARE_GATEWAY_ID
echo "$NEW_TOKEN" | wrangler secret put CLOUDFLARE_API_TOKEN

echo "   ✅ 环境变量已更新"

# 5. 重新部署 Worker
echo -e "\n5. 重新部署 Worker："
wrangler deploy

# 6. 测试 Worker
echo -e "\n6. 等待部署完成并测试 Worker："
sleep 15

test_response=$(curl -s -w "HTTPSTATUS:%{http_code}" \
  -X POST "https://meridian-ai-worker.swj299792458.workers.dev/ai" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer j+96PlDDJPVI7dAhoxdWfgynQTxqEzf5vnea6wrhKXg=" \
  -d '{
    "capability": "chat",
    "messages": [{"role": "user", "content": "Hello, this is a test"}],
    "provider": "workers-ai", 
    "model": "@cf/meta/llama-2-7b-chat-int8",
    "max_tokens": 50
  }')

test_code=$(echo $test_response | sed -e 's/.*HTTPSTATUS://')
test_body=$(echo $test_response | sed -e 's/HTTPSTATUS\:.*//g')

echo "   HTTP 状态码: $test_code"
if [[ "$test_code" == "200" ]]; then
    echo "   ✅ Worker 测试成功！"
    echo "   响应预览: $(echo "$test_body" | jq -r '.choices[0].message.content // .result.response // "解析失败"' 2>/dev/null || echo "解析失败")"
else
    echo "   ❌ Worker 测试失败"
    echo "   错误详情: $test_body"
fi

echo -e "\n=== 验证完成 ==="
echo "✅ 如果上述测试成功，您的 AI Gateway 现在应该可以正常工作了！"

