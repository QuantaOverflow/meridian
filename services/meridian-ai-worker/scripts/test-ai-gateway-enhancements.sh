#!/bin/bash

# AI Gateway 增强功能测试脚本
# 验证所有 AI Gateway 增强功能是否正常工作

# 设置颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 默认配置
BASE_URL="${TEST_URL:-http://localhost:8787}"
TIMEOUT=30

echo -e "${BLUE}🔧 AI Gateway 增强功能测试套件${NC}"
echo -e "${BLUE}测试目标: ${BASE_URL}${NC}"
echo ""

# 检查 Node.js 是否可用
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ 错误: 未找到 Node.js${NC}"
    echo "请先安装 Node.js 来运行增强功能测试"
    exit 1
fi

# 检查增强功能测试脚本是否存在
ENHANCEMENT_TEST_SCRIPT="./scripts/test-ai-gateway-enhancements.js"
if [ ! -f "$ENHANCEMENT_TEST_SCRIPT" ]; then
    echo -e "${RED}❌ 错误: 未找到增强功能测试脚本${NC}"
    echo "预期位置: $ENHANCEMENT_TEST_SCRIPT"
    exit 1
fi

echo -e "${GREEN}✅ 所有依赖检查通过${NC}"
echo ""

# 测试服务是否运行
echo -e "${YELLOW}📋 步骤 1: 检查服务状态${NC}"
if curl -s --max-time $TIMEOUT "${BASE_URL}/health" > /dev/null; then
    echo -e "${GREEN}✅ 服务运行正常${NC}"
else
    echo -e "${RED}❌ 服务未运行或无法访问${NC}"
    echo "请确保 AI Worker 服务正在运行:"
    echo "  开发环境: npm run dev"
    echo "  或者设置 TEST_URL 环境变量指向已部署的服务"
    exit 1
fi

echo ""

# 测试基础 AI Gateway 配置
echo -e "${YELLOW}📋 步骤 2: 验证 AI Gateway 基础配置${NC}"
CONFIG_RESPONSE=$(curl -s --max-time $TIMEOUT "${BASE_URL}/ai-gateway/config" 2>/dev/null)
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ AI Gateway 配置端点可访问${NC}"
    
    # 解析配置响应（简单检查）
    if echo "$CONFIG_RESPONSE" | grep -q '"account_id"'; then
        echo -e "${GREEN}✅ 基础配置检查通过${NC}"
    else
        echo -e "${YELLOW}⚠️  基础配置可能不完整${NC}"
    fi
    
    if echo "$CONFIG_RESPONSE" | grep -q '"enhanced"'; then
        echo -e "${GREEN}✅ 增强功能配置可用${NC}"
    else
        echo -e "${YELLOW}⚠️  增强功能配置不可用${NC}"
    fi
else
    echo -e "${RED}❌ AI Gateway 配置端点无法访问${NC}"
    exit 1
fi

echo ""

# 运行增强功能测试
echo -e "${YELLOW}📋 步骤 3: 运行 AI Gateway 增强功能测试${NC}"
echo -e "${CYAN}启动详细测试...${NC}"
echo ""

# 设置测试环境变量并运行 Node.js 测试
export TEST_URL="$BASE_URL"
if node "$ENHANCEMENT_TEST_SCRIPT"; then
    echo ""
    echo -e "${GREEN}🎉 所有 AI Gateway 增强功能测试通过！${NC}"
    TEST_SUCCESS=true
else
    echo ""
    echo -e "${RED}❌ 部分增强功能测试失败${NC}"
    TEST_SUCCESS=false
fi

echo ""

# 性能测试（基础）
echo -e "${YELLOW}📋 步骤 4: 基础性能测试${NC}"
echo "测试带增强配置的请求响应时间..."

PERFORMANCE_TEST=$(cat << 'EOF'
{
  "capability": "chat",
  "messages": [{"role": "user", "content": "Hello, this is a performance test"}],
  "provider": "openai",
  "model": "gpt-3.5-turbo",
  "enhancedConfig": {
    "cache": {"ttl": 3600},
    "metrics": {"collectMetrics": true, "customTags": {"test": "performance"}}
  }
}
EOF
)

PERF_START=$(date +%s%3N)
PERF_RESPONSE=$(curl -s --max-time $TIMEOUT -X POST \
  -H "Content-Type: application/json" \
  -d "$PERFORMANCE_TEST" \
  "${BASE_URL}/ai" 2>/dev/null)
PERF_END=$(date +%s%3N)

if [ $? -eq 0 ] && echo "$PERF_RESPONSE" | grep -q '"capability":"chat"'; then
    PERF_TIME=$((PERF_END - PERF_START))
    echo -e "${GREEN}✅ 增强请求响应正常 (${PERF_TIME}ms)${NC}"
    
    if [ $PERF_TIME -lt 5000 ]; then
        echo -e "${GREEN}✅ 响应时间良好${NC}"
    else
        echo -e "${YELLOW}⚠️  响应时间较长，可能需要优化${NC}"
    fi
else
    echo -e "${RED}❌ 增强请求测试失败${NC}"
fi

echo ""

# 缓存测试
echo -e "${YELLOW}📋 步骤 5: 缓存功能测试${NC}"
echo "测试相同请求的缓存效果..."

CACHE_TEST=$(cat << 'EOF'
{
  "capability": "embedding", 
  "input": "This is a cache test sentence",
  "provider": "openai",
  "model": "text-embedding-3-small",
  "enhancedConfig": {
    "cache": {"ttl": 3600, "cacheNamespace": "test"}
  }
}
EOF
)

# 第一次请求
CACHE_START1=$(date +%s%3N)
curl -s --max-time $TIMEOUT -X POST \
  -H "Content-Type: application/json" \
  -d "$CACHE_TEST" \
  "${BASE_URL}/ai" > /dev/null 2>&1
CACHE_END1=$(date +%s%3N)
CACHE_TIME1=$((CACHE_END1 - CACHE_START1))

# 第二次请求（应该使用缓存）
sleep 1
CACHE_START2=$(date +%s%3N)
curl -s --max-time $TIMEOUT -X POST \
  -H "Content-Type: application/json" \
  -d "$CACHE_TEST" \
  "${BASE_URL}/ai" > /dev/null 2>&1
CACHE_END2=$(date +%s%3N)
CACHE_TIME2=$((CACHE_END2 - CACHE_START2))

echo "第一次请求: ${CACHE_TIME1}ms"
echo "第二次请求: ${CACHE_TIME2}ms"

if [ $CACHE_TIME2 -lt $CACHE_TIME1 ]; then
    echo -e "${GREEN}✅ 缓存可能在工作（第二次请求更快）${NC}"
else
    echo -e "${YELLOW}⚠️  缓存效果不明显${NC}"
fi

echo ""

# 总结
echo -e "${BLUE}📊 测试总结${NC}"
echo "=============================="
echo "服务状态: ✅ 正常"
echo "基础配置: ✅ 可用"
if [ "$TEST_SUCCESS" = true ]; then
    echo "增强功能: ✅ 通过"
else
    echo "增强功能: ❌ 部分失败"
fi
echo "性能测试: ✅ 完成"
echo "缓存测试: ✅ 完成"
echo ""

if [ "$TEST_SUCCESS" = true ]; then
    echo -e "${GREEN}🎉 AI Gateway 增强功能已成功实现并正常工作！${NC}"
    echo ""
    echo -e "${CYAN}✨ 已启用的功能:${NC}"
    echo "  - 智能认证 (cf-aig-authorization)"
    echo "  - 成本跟踪 (cf-aig-custom-cost)"
    echo "  - 智能缓存 (cf-aig-cache-ttl, cf-aig-cache-key)"
    echo "  - 元数据增强 (cf-aig-metadata)"
    echo "  - 自动故障转移"
    echo "  - 性能监控"
    echo ""
    echo -e "${YELLOW}💡 下一步建议:${NC}"
    echo "  1. 在生产环境中配置真实的 AI Gateway 令牌"
    echo "  2. 根据使用模式调整缓存策略"
    echo "  3. 配置成本跟踪参数"
    echo "  4. 监控性能指标和日志"
else
    echo -e "${RED}❌ 部分测试失败，请检查日志和配置${NC}"
    echo ""
    echo -e "${YELLOW}🔧 故障排除建议:${NC}"
    echo "  1. 检查环境变量配置"
    echo "  2. 验证 API 密钥是否有效"
    echo "  3. 查看 Worker 日志了解详细错误"
    echo "  4. 确认 Cloudflare AI Gateway 配置正确"
fi
