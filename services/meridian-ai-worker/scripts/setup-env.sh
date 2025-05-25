#!/bin/bash

# Meridian AI Worker 环境变量配置助手
# 帮助设置部署所需的所有环境变量

# 设置颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔧 Meridian AI Worker 环境变量配置助手${NC}"
echo ""

# 检查是否安装了 wrangler
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ 错误: 未找到 wrangler CLI${NC}"
    echo "请先安装 wrangler: npm install -g wrangler"
    exit 1
fi

echo -e "${GREEN}✅ 检测到 wrangler CLI${NC}"
echo ""

# 基础配置
echo -e "${YELLOW}📋 步骤 1: 配置 Cloudflare AI Gateway 基础信息${NC}"
echo ""

read -p "请输入您的 Cloudflare Account ID: " ACCOUNT_ID
if [[ -n "$ACCOUNT_ID" ]]; then
    wrangler secret put CLOUDFLARE_ACCOUNT_ID --env production <<< "$ACCOUNT_ID"
    echo -e "${GREEN}✅ CLOUDFLARE_ACCOUNT_ID 已设置${NC}"
else
    echo -e "${RED}❌ Account ID 不能为空${NC}"
    exit 1
fi

read -p "请输入您的 AI Gateway ID: " GATEWAY_ID
if [[ -n "$GATEWAY_ID" ]]; then
    wrangler secret put CLOUDFLARE_GATEWAY_ID --env production <<< "$GATEWAY_ID"
    echo -e "${GREEN}✅ CLOUDFLARE_GATEWAY_ID 已设置${NC}"
else
    echo -e "${RED}❌ Gateway ID 不能为空${NC}"
    exit 1
fi

read -p "请输入您的 Cloudflare API Token: " API_TOKEN
if [[ -n "$API_TOKEN" ]]; then
    wrangler secret put CLOUDFLARE_API_TOKEN --env production <<< "$API_TOKEN"
    echo -e "${GREEN}✅ CLOUDFLARE_API_TOKEN 已设置${NC}"
else
    echo -e "${RED}❌ API Token 不能为空${NC}"
    exit 1
fi

echo ""

# AI 提供商配置
echo -e "${YELLOW}📋 步骤 2: 配置 AI 提供商 API 密钥${NC}"
echo "至少需要配置一个提供商的 API 密钥"
echo ""

read -p "是否配置 OpenAI API 密钥? (y/n): " configure_openai
if [[ "$configure_openai" == "y" || "$configure_openai" == "Y" ]]; then
    read -p "请输入您的 OpenAI API Key: " OPENAI_KEY
    if [[ -n "$OPENAI_KEY" ]]; then
        wrangler secret put OPENAI_API_KEY --env production <<< "$OPENAI_KEY"
        echo -e "${GREEN}✅ OPENAI_API_KEY 已设置${NC}"
    fi
fi

read -p "是否配置 Anthropic API 密钥? (y/n): " configure_anthropic
if [[ "$configure_anthropic" == "y" || "$configure_anthropic" == "Y" ]]; then
    read -p "请输入您的 Anthropic API Key: " ANTHROPIC_KEY
    if [[ -n "$ANTHROPIC_KEY" ]]; then
        wrangler secret put ANTHROPIC_API_KEY --env production <<< "$ANTHROPIC_KEY"
        echo -e "${GREEN}✅ ANTHROPIC_API_KEY 已设置${NC}"
    fi
fi

echo ""

# AI Gateway 增强功能配置
echo -e "${YELLOW}📋 步骤 3: 配置 AI Gateway 增强功能 (可选)${NC}"
echo ""

read -p "是否启用 AI Gateway 增强认证? (y/n): " enable_auth
if [[ "$enable_auth" == "y" || "$enable_auth" == "Y" ]]; then
    read -p "请输入 AI Gateway 认证令牌: " AUTH_TOKEN
    if [[ -n "$AUTH_TOKEN" ]]; then
        wrangler secret put AI_GATEWAY_TOKEN --env production <<< "$AUTH_TOKEN"
        echo -e "${GREEN}✅ AI_GATEWAY_TOKEN 已设置${NC}"
    fi
    
    wrangler secret put ENABLE_AI_GATEWAY_AUTH --env production <<< "true"
    echo -e "${GREEN}✅ AI Gateway 增强认证已启用${NC}"
fi

read -p "是否启用成本跟踪? (y/n): " enable_cost
if [[ "$enable_cost" == "y" || "$enable_cost" == "Y" ]]; then
    wrangler secret put ENABLE_COST_TRACKING --env production <<< "true"
    echo -e "${GREEN}✅ 成本跟踪已启用${NC}"
fi

read -p "是否启用智能缓存? (y/n): " enable_cache
if [[ "$enable_cache" == "y" || "$enable_cache" == "Y" ]]; then
    wrangler secret put ENABLE_AI_GATEWAY_CACHING --env production <<< "true"
    
    read -p "设置默认缓存时间 (秒，默认3600): " cache_ttl
    cache_ttl=${cache_ttl:-3600}
    wrangler secret put DEFAULT_CACHE_TTL --env production <<< "$cache_ttl"
    echo -e "${GREEN}✅ 智能缓存已启用，默认TTL: ${cache_ttl}秒${NC}"
fi

read -p "是否启用指标收集? (y/n): " enable_metrics
if [[ "$enable_metrics" == "y" || "$enable_metrics" == "Y" ]]; then
    wrangler secret put ENABLE_AI_GATEWAY_METRICS --env production <<< "true"
    echo -e "${GREEN}✅ 指标收集已启用${NC}"
fi

read -p "是否启用详细日志? (y/n): " enable_logging
if [[ "$enable_logging" == "y" || "$enable_logging" == "Y" ]]; then
    wrangler secret put ENABLE_AI_GATEWAY_LOGGING --env production <<< "true"
    
    read -p "设置日志级别 (debug/info/warn/error，默认info): " log_level
    log_level=${log_level:-info}
    wrangler secret put AI_GATEWAY_LOG_LEVEL --env production <<< "$log_level"
    echo -e "${GREEN}✅ 详细日志已启用，级别: ${log_level}${NC}"
fi

echo ""
echo -e "${GREEN}🎉 环境变量配置完成！${NC}"
echo ""
echo -e "${BLUE}📋 下一步操作:${NC}"
echo "1. 运行部署: wrangler deploy --env production"
echo "2. 运行测试: ./scripts/test-deployment.sh"
echo "3. 验证功能: 访问您的 Worker 域名"
echo ""
echo -e "${YELLOW}💡 提示:${NC}"
echo "- 可以随时使用 'wrangler secret list --env production' 查看已设置的变量"
echo "- 使用 'wrangler secret delete <SECRET_NAME> --env production' 删除变量"
echo "- 修改变量需要重新运行对应的 'wrangler secret put' 命令"
