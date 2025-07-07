# 获取当前日期
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 计算过去一个月的日期（近似值，确保包含整个月）
# 例如，如果今天是 2024-06-22，则 fromDate 会是 2024-05-22
# 由于 Bash/date 命令的限制，这里进行一个简单的减法，您可能需要根据实际需求调整以确保精确覆盖整个日历月
FROM_DATE=$(date -v-1m -u +"%Y-%m-%dT00:00:00Z") # 减去一个月，并设为月初

# 构造 JSON 请求体
REQUEST_BODY=$(cat <<EOF
{
  "dateFrom": "$FROM_DATE",
  "dateTo": "$NOW",
  "articleLimit": 100
}
EOF
)

# 执行 POST 请求
curl -X POST "https://api1.pathsoflight.org/admin/briefs/generate" \
-H "Content-Type: application/json" \
-d "$REQUEST_BODY"

echo "生成的请求体: $REQUEST_BODY"
