# API 测试脚本

## 健康检查
curl -X GET http://localhost:8787/health

## 获取可用提供商
curl -X GET http://localhost:8787/providers

## 测试 OpenAI 聊天
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "provider": "openai",
    "model": "gpt-4o-mini",
    "temperature": 0.7,
    "max_tokens": 100
  }'

## 测试带故障转移的聊天
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What is artificial intelligence?"}
    ],
    "provider": "workers-ai",
    "fallback": true,
    "max_tokens": 200
  }'

## 测试 Anthropic Claude
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Explain quantum computing in simple terms."}
    ],
    "provider": "anthropic",
    "model": "claude-3-sonnet-20240229",
    "temperature": 0.5,
    "max_tokens": 300
  }'

## 测试多轮对话
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello"},
      {"role": "assistant", "content": "Hi there! How can I help you today?"},
      {"role": "user", "content": "What is the weather like?"}
    ],
    "provider": "openai",
    "temperature": 0.8
  }'
