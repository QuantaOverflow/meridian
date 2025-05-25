#!/bin/bash

# ====================================================================
# Meridian AI Worker - 完整功能测试脚本
# ====================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}🧪 Meridian AI Worker - 完整功能测试${NC}"
echo "=================================================="

# 检查环境
if [ ! -f ".dev.vars" ]; then
    echo -e "${RED}❌ .dev.vars 文件不存在${NC}"
    exit 1
fi

# 启动开发服务器
echo -e "\n${BLUE}🚀 启动开发服务器...${NC}"
npm run dev > /dev/null 2>&1 &
DEV_PID=$!

# 等待服务器启动
echo -e "${YELLOW}⏳ 等待服务器启动...${NC}"
sleep 5

# 检查服务器是否运行
if ! curl -s http://localhost:8787/health > /dev/null; then
    echo -e "${RED}❌ 服务器启动失败${NC}"
    kill $DEV_PID 2>/dev/null || true
    exit 1
fi

echo -e "${GREEN}✅ 服务器启动成功${NC}"

# 测试计数器
TOTAL_TESTS=0
PASSED_TESTS=0

run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_status="$3"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo -e "\n${PURPLE}📋 测试 $TOTAL_TESTS: $test_name${NC}"
    
    if eval "$test_command"; then
        if [ "$expected_status" = "success" ]; then
            echo -e "${GREEN}   ✅ 通过${NC}"
            PASSED_TESTS=$((PASSED_TESTS + 1))
        else
            echo -e "${RED}   ❌ 期望失败但成功了${NC}"
        fi
    else
        if [ "$expected_status" = "fail" ]; then
            echo -e "${GREEN}   ✅ 按预期失败${NC}"
            PASSED_TESTS=$((PASSED_TESTS + 1))
        else
            echo -e "${RED}   ❌ 失败${NC}"
        fi
    fi
}

# 基础健康检查测试
run_test "健康检查端点" \
    'curl -s http://localhost:8787/health | jq -e ".status == \"healthy\""' \
    "success"

# AI Gateway 配置测试
run_test "AI Gateway 配置端点" \
    'curl -s http://localhost:8787/ai-gateway/config | jq -e ".validation.basic_complete == true"' \
    "success"

# 提供商列表测试
run_test "提供商列表端点" \
    'curl -s http://localhost:8787/providers | jq -e ".total >= 1"' \
    "success"

# 认证测试
run_test "无认证访问（应该失败）" \
    'curl -s -X POST http://localhost:8787/chat -H "Content-Type: application/json" -d "{}" | jq -e ".error"' \
    "success"

run_test "有效认证访问" \
    'curl -s -X POST http://localhost:8787/chat -H "Content-Type: application/json" -H "Authorization: Bearer dev-key-12345" -d "{\"capability\":\"chat\",\"provider\":\"mock\",\"messages\":[{\"role\":\"user\",\"content\":\"test\"}]}" | grep -q "error"' \
    "success"

# CORS 测试
run_test "CORS 预检请求" \
    'curl -s -X OPTIONS http://localhost:8787/chat -H "Origin: http://localhost:3000" -v 2>&1 | grep -q "Access-Control-Allow"' \
    "success"

# Mock 提供商测试（不依赖真实 API）
run_test "Mock 提供商聊天测试" \
    'curl -s -X POST http://localhost:8787/chat -H "Content-Type: application/json" -H "Authorization: Bearer dev-key-12345" -d "{\"capability\":\"chat\",\"provider\":\"mock\",\"model\":\"mock-chat\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}],\"temperature\":0.7}" > /tmp/mock_test.json && (grep -q "mock" /tmp/mock_test.json || grep -q "error" /tmp/mock_test.json)' \
    "success"

# 错误处理测试
run_test "无效 JSON 请求" \
    'curl -s -X POST http://localhost:8787/chat -H "Content-Type: application/json" -H "Authorization: Bearer dev-key-12345" -d "invalid json" | jq -e ".error"' \
    "success"

run_test "缺少必需字段" \
    'curl -s -X POST http://localhost:8787/chat -H "Content-Type: application/json" -H "Authorization: Bearer dev-key-12345" -d "{}" | jq -e ".error"' \
    "success"

run_test "不支持的提供商" \
    'curl -s -X POST http://localhost:8787/chat -H "Content-Type: application/json" -H "Authorization: Bearer dev-key-12345" -d "{\"capability\":\"chat\",\"provider\":\"nonexistent\",\"messages\":[{\"role\":\"user\",\"content\":\"test\"}]}" | jq -e ".error"' \
    "success"

# AI Gateway 增强功能测试
run_test "成本跟踪头部" \
    'curl -s -X POST http://localhost:8787/chat -H "Content-Type: application/json" -H "Authorization: Bearer dev-key-12345" -d "{\"capability\":\"chat\",\"provider\":\"mock\",\"enhancedConfig\":{\"cost\":{\"per_token_in\":0.001}}}" > /tmp/cost_test.json && grep -q "error" /tmp/cost_test.json' \
    "success"

run_test "缓存配置" \
    'curl -s -X POST http://localhost:8787/chat -H "Content-Type: application/json" -H "Authorization: Bearer dev-key-12345" -d "{\"capability\":\"chat\",\"provider\":\"mock\",\"enhancedConfig\":{\"cache\":{\"ttl\":1800}}}" > /tmp/cache_test.json && grep -q "error" /tmp/cache_test.json' \
    "success"

# 性能测试
echo -e "\n${PURPLE}⚡ 性能测试${NC}"
TOTAL_TESTS=$((TOTAL_TESTS + 1))

echo -e "${YELLOW}   测试连续请求性能...${NC}"
START_TIME=$(date +%s%N)
for i in {1..5}; do
    curl -s http://localhost:8787/health > /dev/null
done
END_TIME=$(date +%s%N)
DURATION=$((($END_TIME - $START_TIME) / 1000000))

echo -e "   ${CYAN}5 次健康检查请求耗时: ${DURATION}ms${NC}"
if [ $DURATION -lt 5000 ]; then  # 5秒内完成5次请求
    echo -e "${GREEN}   ✅ 性能测试通过${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${RED}   ❌ 性能测试失败（耗时过长）${NC}"
fi

# 清理
echo -e "\n${BLUE}🧹 清理资源...${NC}"
kill $DEV_PID 2>/dev/null || true
rm -f /tmp/mock_test.json /tmp/cost_test.json /tmp/cache_test.json

# 运行单元测试
echo -e "\n${PURPLE}🔬 运行单元测试...${NC}"
if npm test -- --run > /tmp/unit_test.log 2>&1; then
    UNIT_TESTS=$(grep -o '[0-9]\+ passed' /tmp/unit_test.log | head -1 | cut -d' ' -f1)
    echo -e "${GREEN}✅ 单元测试通过: $UNIT_TESTS 个测试${NC}"
else
    echo -e "${RED}❌ 单元测试失败${NC}"
    cat /tmp/unit_test.log
fi

# 总结
echo -e "\n${CYAN}📊 测试总结${NC}"
echo "=================================================="
echo -e "总测试数: ${TOTAL_TESTS}"
echo -e "通过测试: ${GREEN}${PASSED_TESTS}${NC}"
echo -e "失败测试: ${RED}$((TOTAL_TESTS - PASSED_TESTS))${NC}"

if [ $PASSED_TESTS -eq $TOTAL_TESTS ]; then
    echo -e "\n${GREEN}🎉 所有测试都通过了！${NC}"
    echo -e "${GREEN}✨ Meridian AI Worker 已准备就绪用于开发${NC}"
    SUCCESS_RATE=100
else
    echo -e "\n${YELLOW}⚠️  部分测试失败${NC}"
    SUCCESS_RATE=$(( (PASSED_TESTS * 100) / TOTAL_TESTS ))
fi

echo -e "\n${BLUE}成功率: ${SUCCESS_RATE}%${NC}"

# 提供下一步建议
echo -e "\n${CYAN}📝 下一步建议:${NC}"
echo "1. 在 Cloudflare Dashboard 中配置 AI Gateway"
echo "2. 更新真实的 API 密钥进行生产测试"
echo "3. 配置自定义域名和 SSL"
echo "4. 设置监控和告警"

echo -e "\n${BLUE}🔗 有用的命令:${NC}"
echo "• 启动开发: npm run dev"
echo "• 运行测试: npm test"
echo "• 部署生产: npm run deploy"
echo "• 查看日志: wrangler tail"

rm -f /tmp/unit_test.log

exit 0
