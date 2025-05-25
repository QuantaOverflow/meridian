#!/bin/bash

# ====================================================================
# Meridian AI Worker - 本地环境配置脚本
# ====================================================================

set -e  # 遇到错误时退出

echo "🚀 Meridian AI Worker - 本地环境配置向导"
echo "========================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检查必需文件
echo -e "\n${BLUE}📋 检查配置文件...${NC}"

if [ ! -f ".dev.vars" ]; then
    echo -e "${RED}❌ .dev.vars 文件不存在${NC}"
    exit 1
fi

if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ package.json 文件不存在，请确保在正确的目录中运行${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 配置文件检查完成${NC}"

# 读取现有配置
echo -e "\n${BLUE}📖 读取环境变量配置...${NC}"

source .dev.vars

# 必需变量检查
REQUIRED_VARS=(
    "CLOUDFLARE_ACCOUNT_ID"
    "CLOUDFLARE_GATEWAY_ID"
    "CLOUDFLARE_API_TOKEN"
    "OPENAI_API_KEY"
)

MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ] || [ "${!var}" = "your_"* ]; then
        MISSING_VARS+=("$var")
    fi
done

# 显示配置状态
echo -e "\n${YELLOW}📊 环境变量配置状态:${NC}"

echo "┌─────────────────────────────────────────────────────────────┐"
echo "│                    基础配置                                   │"
echo "├─────────────────────────────────────────────────────────────┤"

check_var() {
    local var_name=$1
    local var_value=${!var_name}
    local status
    
    if [ -z "$var_value" ] || [ "$var_value" = "your_"* ]; then
        status="${RED}❌ 未配置${NC}"
    else
        status="${GREEN}✅ 已配置${NC}"
    fi
    
    printf "│ %-30s %s\n" "$var_name:" "$status"
}

check_var "CLOUDFLARE_ACCOUNT_ID"
check_var "CLOUDFLARE_GATEWAY_ID"
check_var "CLOUDFLARE_API_TOKEN"
check_var "OPENAI_API_KEY"

echo "├─────────────────────────────────────────────────────────────┤"
echo "│                  可选 AI 提供商                               │"
echo "├─────────────────────────────────────────────────────────────┤"

check_var "ANTHROPIC_API_KEY"
check_var "GOOGLE_API_KEY"
check_var "AZURE_OPENAI_API_KEY"

echo "├─────────────────────────────────────────────────────────────┤"
echo "│                AI Gateway 增强功能                           │"
echo "├─────────────────────────────────────────────────────────────┤"

printf "│ %-30s %s\n" "成本跟踪:" "${ENABLE_COST_TRACKING:-false}"
printf "│ %-30s %s\n" "智能缓存:" "${ENABLE_CACHING:-false}"
printf "│ %-30s %s\n" "指标收集:" "${ENABLE_METRICS:-false}"
printf "│ %-30s %s\n" "详细日志:" "${ENABLE_LOGGING:-false}"

echo "└─────────────────────────────────────────────────────────────┘"

# 如果有缺失的必需变量，提供配置指导
if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo -e "\n${YELLOW}⚠️  发现缺失的必需配置:${NC}"
    
    for var in "${MISSING_VARS[@]}"; do
        echo -e "   ${RED}• $var${NC}"
    done
    
    echo -e "\n${BLUE}📝 配置指导:${NC}"
    
    echo -e "\n1. ${YELLOW}Cloudflare 配置${NC}"
    echo "   • 登录 Cloudflare Dashboard: https://dash.cloudflare.com"
    echo "   • 获取账户 ID: 右侧栏 -> 账户 ID"
    echo "   • 创建 AI Gateway: AI -> AI Gateway -> Create Gateway"
    echo "   • 生成 API Token: 我的个人资料 -> API 令牌"
    
    echo -e "\n2. ${YELLOW}AI 提供商配置${NC}"
    echo "   • OpenAI: https://platform.openai.com/api-keys"
    echo "   • Anthropic: https://console.anthropic.com/settings/keys"
    echo "   • Google AI: https://makersuite.google.com/app/apikey"
    
    echo -e "\n3. ${YELLOW}编辑 .dev.vars 文件${NC}"
    echo "   替换对应的占位符值"
    
    echo -e "\n${RED}❌ 请先配置必需的环境变量再继续${NC}"
    exit 1
fi

echo -e "\n${GREEN}✅ 所有必需的环境变量都已配置${NC}"

# 验证 Node.js 和依赖
echo -e "\n${BLUE}🔍 检查开发环境...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js 未安装${NC}"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2)
echo -e "${GREEN}✅ Node.js 版本: $NODE_VERSION${NC}"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm 未安装${NC}"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 安装依赖...${NC}"
    npm install
fi

echo -e "${GREEN}✅ 依赖检查完成${NC}"

# 验证 Wrangler
echo -e "\n${BLUE}🔧 检查 Wrangler...${NC}"

if ! command -v wrangler &> /dev/null; then
    echo -e "${YELLOW}📦 安装 Wrangler...${NC}"
    npm install -g wrangler
fi

WRANGLER_VERSION=$(wrangler --version)
echo -e "${GREEN}✅ Wrangler 版本: $WRANGLER_VERSION${NC}"

# 提供快速启动命令
echo -e "\n${GREEN}🎉 环境配置完成！${NC}"
echo -e "\n${BLUE}📋 快速启动命令:${NC}"
echo -e "   ${YELLOW}启动开发服务器:${NC} npm run dev"
echo -e "   ${YELLOW}运行测试:${NC}       npm test"
echo -e "   ${YELLOW}健康检查:${NC}       npm run health"
echo -e "   ${YELLOW}查看配置:${NC}       npm run config"

echo -e "\n${BLUE}🌐 本地端点:${NC}"
echo -e "   • Health Check: http://localhost:8787/health"
echo -e "   • Config Check: http://localhost:8787/ai-gateway/config"
echo -e "   • Providers:    http://localhost:8787/providers"

echo -e "\n${GREEN}✨ 准备就绪！现在可以开始开发了${NC}"
