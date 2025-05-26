#!/bin/bash

# 批量测试脚本
BASE_URL="https://meridian-ai-worker.swj299792458.workers.dev"
TOKEN="j+96PlDDJPVI7dAhoxdWfgynQTxqEzf5vnea6wrhKXg="

echo "🔍 1. 健康检查..."
curl -s -X GET "$BASE_URL/health" -H "Authorization: Bearer $TOKEN" | jq .

echo -e "\n📋 2. 获取提供商列表..."
curl -s -X GET "$BASE_URL/providers" -H "Authorization: Bearer $TOKEN" | jq .

echo -e "\n💬 3. 基础聊天测试..."
curl -s -X POST "$BASE_URL/ai" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "capability": "chat",
    "messages": [{"role": "user", "content": "Hello from batch test!"}],
    "provider": "openai",
    "model": "gpt-3.5-turbo"
  }' | jq .

echo -e "\n⚡ 4. 增强功能测试..."
curl -s -X POST "$BASE_URL/ai" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "capability": "chat",
    "messages": [{"role": "user", "content": "Test enhanced features"}],
    "enhancedConfig": {
      "cache": {"ttl": 3600},
      "metadata": {"tags": {"test": "batch"}}
    }
  }' | jq .

echo -e "\n🧪 5. Workers AI 测试..."
curl -s -X POST "$BASE_URL/ai" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "capability": "chat",
    "messages": [{"role": "user", "content": "Test Workers AI provider"}],
    "provider": "workers-ai",
    "model": "@cf/meta/llama-2-7b-chat-int8"
  }' | jq .

echo -e "\n🔄 6. 自动提供商选择测试..."
curl -s -X POST "$BASE_URL/ai" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "capability": "chat",
    "messages": [{"role": "user", "content": "Test automatic provider selection"}],
    "fallback": true
  }' | jq .

echo -e "\n✅ 测试完成！"