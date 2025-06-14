#!/bin/bash

# Meridian Backend 测试运行脚本
# 由于 Cloudflare Workers 环境限制，需要单独运行测试文件避免资源冲突

set -e

echo "🧪 运行 Meridian Backend 测试套件"
echo "================================="

# 定义测试文件列表
TEST_FILES=(
  "test/example.test.ts"
  "test/parseRss.spec.ts"
)

# 计数器
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

echo ""
echo "📋 测试文件列表："
for file in "${TEST_FILES[@]}"; do
  echo "   - $file"
done

echo ""
echo "🚀 开始运行测试..."
echo ""

# 逐个运行测试文件
for test_file in "${TEST_FILES[@]}"; do
  echo "▶️  运行 $test_file"
  echo "   ---"
  
  if npm test -- "$test_file"; then
    echo "   ✅ $test_file 通过"
    ((PASSED_TESTS++))
  else
    echo "   ❌ $test_file 失败"
    ((FAILED_TESTS++))
  fi
  
  ((TOTAL_TESTS++))
  echo ""
  
  # 在测试之间添加短暂延迟，确保资源清理
  sleep 1
done

echo "================================="
echo "📊 测试结果总结："
echo "   总计: $TOTAL_TESTS 个测试文件"
echo "   通过: $PASSED_TESTS 个"
echo "   失败: $FAILED_TESTS 个"

if [ $FAILED_TESTS -eq 0 ]; then
  echo ""
  echo "🎉 所有测试都通过了！"
  exit 0
else
  echo ""
  echo "⚠️  有 $FAILED_TESTS 个测试文件失败"
  exit 1
fi 