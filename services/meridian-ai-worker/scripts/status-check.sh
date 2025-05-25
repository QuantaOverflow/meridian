#!/bin/bash

# ====================================================================
# Meridian AI Worker - 快速状态检查
# ====================================================================

echo "🔍 Meridian AI Worker - 快速状态检查"
echo "======================================"

# 检查是否在正确目录
if [ ! -f "package.json" ] || [ ! -f ".dev.vars" ]; then
    echo "❌ 请在 meridian-ai-worker 项目根目录运行此脚本"
    exit 1
fi

# 检查开发服务器状态
echo -n "🌐 开发服务器状态: "
if curl -s http://localhost:8787/health > /dev/null 2>&1; then
    echo "✅ 运行中"
    
    # 获取详细状态
    STATUS=$(curl -s http://localhost:8787/health | jq -r '.status // "unknown"')
    VERSION=$(curl -s http://localhost:8787/health | jq -r '.version // "unknown"')
    ENV=$(curl -s http://localhost:8787/health | jq -r '.environment // "unknown"')
    
    echo "   状态: $STATUS"
    echo "   版本: $VERSION" 
    echo "   环境: $ENV"
    
    # 检查可用提供商
    PROVIDERS=$(curl -s http://localhost:8787/providers | jq -r '.total // 0')
    echo "   可用提供商: $PROVIDERS 个"
    
else
    echo "❌ 未运行"
    echo "   启动命令: npm run dev"
fi

# 检查配置状态
echo -n "⚙️  AI Gateway 配置: "
if curl -s http://localhost:8787/ai-gateway/config > /dev/null 2>&1; then
    BASIC_COMPLETE=$(curl -s http://localhost:8787/ai-gateway/config | jq -r '.validation.basic_complete // false')
    if [ "$BASIC_COMPLETE" = "true" ]; then
        echo "✅ 完整"
    else
        echo "⚠️  不完整"
    fi
else
    echo "❌ 无法访问"
fi

# 检查环境变量
echo "📋 关键环境变量:"
source .dev.vars 2>/dev/null || true

check_var() {
    local var_name=$1
    local var_value=${!var_name}
    if [ -n "$var_value" ] && [ "$var_value" != "your_"* ]; then
        echo "   ✅ $var_name: 已配置"
    else
        echo "   ❌ $var_name: 未配置"
    fi
}

check_var "CLOUDFLARE_ACCOUNT_ID"
check_var "OPENAI_API_KEY"
check_var "AI_GATEWAY_TOKEN"

echo ""
echo "🚀 快速命令:"
echo "   npm run dev      # 启动开发服务器"
echo "   npm test         # 运行测试"
echo "   npm run health   # 健康检查"
echo "   ./scripts/test-complete.sh  # 完整测试"
