#!/bin/bash

# Meridian AI Worker 性能测试脚本
# 测试各个端点的响应时间和负载能力

BASE_URL="http://localhost:8787"
ITERATIONS=10

echo "🚀 Meridian AI Worker 性能测试"
echo "================================"
echo "基础 URL: $BASE_URL"
echo "测试迭代次数: $ITERATIONS"
echo ""

# 性能测试函数
performance_test() {
    local name="$1"
    local path="$2"
    local method="${3:-GET}"
    local data="$4"
    
    echo "📊 性能测试: $name"
    echo "   端点: $path"
    
    local total_time=0
    local successful_requests=0
    local failed_requests=0
    
    for ((i=1; i<=ITERATIONS; i++)); do
        if [ "$method" = "POST" ] && [ -n "$data" ]; then
            response_time=$(curl -s -w "%{time_total}" -o /dev/null -X POST "$BASE_URL$path" \
                -H "Content-Type: application/json" \
                -d "$data")
        else
            response_time=$(curl -s -w "%{time_total}" -o /dev/null "$BASE_URL$path")
        fi
        
        exit_code=$?
        if [ $exit_code -eq 0 ]; then
            successful_requests=$((successful_requests + 1))
            total_time=$(echo "$total_time + $response_time" | bc -l)
        else
            failed_requests=$((failed_requests + 1))
        fi
        
        printf "."
    done
    
    echo ""
    
    if [ $successful_requests -gt 0 ]; then
        average_time=$(echo "scale=3; $total_time / $successful_requests" | bc -l)
        echo "   ✅ 成功请求: $successful_requests/$ITERATIONS"
        echo "   ❌ 失败请求: $failed_requests/$ITERATIONS"
        echo "   ⏱️  平均响应时间: ${average_time}s"
        
        if (( $(echo "$average_time < 0.1" | bc -l) )); then
            echo "   🚀 性能评级: 优秀 (< 100ms)"
        elif (( $(echo "$average_time < 0.5" | bc -l) )); then
            echo "   ✅ 性能评级: 良好 (< 500ms)"
        elif (( $(echo "$average_time < 1.0" | bc -l) )); then
            echo "   ⚠️  性能评级: 一般 (< 1s)"
        else
            echo "   ❌ 性能评级: 需要优化 (> 1s)"
        fi
    else
        echo "   ❌ 所有请求都失败了"
    fi
    echo ""
}

# 检查服务器是否运行
echo "🔍 检查服务器连接..."
if ! curl -s "$BASE_URL/health" > /dev/null; then
    echo "❌ 无法连接到服务器。请确保运行: npm run dev"
    exit 1
fi
echo "✅ 服务器连接正常"
echo ""

# 检查 bc 是否安装
if ! command -v bc &> /dev/null; then
    echo "⚠️  bc 计算器未安装，将使用简化的性能测试"
    SIMPLE_MODE=true
else
    SIMPLE_MODE=false
fi

# 运行性能测试
if [ "$SIMPLE_MODE" = "true" ]; then
    echo "🏃‍♂️ 运行简化性能测试..."
    
    for endpoint in "/health" "/ai-gateway/config" "/providers"; do
        echo "测试: $endpoint"
        time curl -s "$BASE_URL$endpoint" > /dev/null
        echo ""
    done
else
    echo "🏃‍♂️ 运行详细性能测试..."
    
    performance_test "健康检查" "/health"
    performance_test "AI Gateway 配置" "/ai-gateway/config"
    performance_test "提供商列表" "/providers"
    performance_test "聊天能力提供商" "/capabilities/chat/providers"
    performance_test "嵌入能力提供商" "/capabilities/embedding/providers"
    
    echo "📈 性能测试总结:"
    echo "   测试项目: 5 个端点"
    echo "   每个端点请求次数: $ITERATIONS"
    echo "   总请求数: $((5 * ITERATIONS))"
    echo ""
    echo "💡 性能优化建议:"
    echo "   1. 启用 AI Gateway 缓存以提升响应速度"
    echo "   2. 使用 CDN 加速静态内容"
    echo "   3. 监控生产环境的实际性能指标"
fi

echo "🎯 性能测试完成！"
