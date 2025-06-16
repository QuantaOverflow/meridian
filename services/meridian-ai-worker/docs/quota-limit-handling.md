# 配额限制处理策略

## 概述

新的配额限制处理功能在 `IntelligenceService` 中实现了分级的错误处理和重试策略，支持测试模式和生产环境的不同行为。

## 功能特性

### 1. 智能错误识别

系统能够识别以下配额限制错误：
- `quota` 相关错误
- `rate limit` 限制
- `resource exhausted` 错误
- `too many requests` (HTTP 429)
- `rate_limit` 字段
- HTTP 状态码 429

### 2. 指数退避重试策略

**生产环境行为：**
- 最多重试 3 次
- 基础延迟：1秒
- 指数退避：每次重试延迟翻倍
- 随机化：添加随机延迟避免雷群效应
- 详细的重试日志记录

**重试公式：**
```
delay = baseDelay * 2^attempt + random(0-1000ms)
```

### 3. 分级Fallback策略

#### 测试模式 (`env.INTEGRATION_TEST_MODE === 'true'` 或 `env.NODE_ENV === 'test'`)

返回测试兼容的标准化报告：
```json
{
  "storyId": "story-test-title",
  "status": "COMPLETE",
  "executiveSummary": "Executive summary for Test Title",
  "storyStatus": "DEVELOPING",
  "timeline": [...],
  "significance": { "level": "MODERATE", ... },
  "entities": [...],
  "sources": [...],
  "factualBasis": ["Fact 1", "Fact 2"],
  "informationGaps": ["Gap 1"],
  "contradictions": []
}
```

#### 生产环境

返回包含错误信息的不完整报告：
```json
{
  "storyId": "story-production-title",
  "status": "INCOMPLETE",
  "executiveSummary": "[配额限制] 无法完成AI分析: Production Title",
  "storyStatus": "STATIC",
  "significance": { "level": "LOW", "reasoning": "由于配额限制，无法进行深度分析" },
  "sources": [{
    "sourceName": "系统错误",
    "reliabilityLevel": "VERY_LOW",
    "bias": "配额限制错误: [具体错误信息]"
  }],
  "informationGaps": [
    "由于API配额限制，无法进行完整的情报分析",
    "建议稍后重试或联系系统管理员"
  ]
}
```

## 使用示例

### 正常调用
```typescript
const service = new IntelligenceService(env);
const result = await service.analyzeSingleStory(story, articles);
```

### 配额限制时的行为

**测试模式：**
```
[Intelligence] 测试模式配额限制，返回测试兼容结果: Story Title
```

**生产环境：**
```
[Intelligence] 配额限制错误，第 1/4 次尝试，2000ms 后重试: {
  error: "Quota exceeded",
  nextDelay: 2000,
  timestamp: "2024-01-01T12:00:00.000Z"
}

[Intelligence] 重试 3 次后仍失败，配额限制错误: {
  error: "Quota exceeded", 
  attempt: 4,
  timestamp: "2024-01-01T12:00:10.000Z"
}

[Intelligence] 生产环境配额限制错误: {
  storyTitle: "Story Title",
  articlesCount: 5,
  error: "Quota exceeded",
  errorType: "QUOTA_LIMIT",
  timestamp: "2024-01-01T12:00:10.000Z",
  requestId: "fallback-1704110410000-abc123"
}
```

## 监控建议

### 关键指标
1. **配额限制频率**：监控 `QUOTA_LIMIT` 错误的发生频率
2. **重试成功率**：跟踪重试后的成功率
3. **Fallback报告比例**：监控使用fallback策略的报告占比

### 告警设置
- 配额限制错误超过阈值时触发告警
- 连续重试失败时发送通知
- Fallback报告比例异常时警报

## 配置建议

### 环境变量
```bash
# 启用测试模式
INTEGRATION_TEST_MODE=true

# 或者
NODE_ENV=test
```

### 生产环境优化
1. **预防性监控**：在接近配额限制前预警
2. **负载均衡**：分散API调用到多个时间段
3. **缓存策略**：减少重复的AI调用
4. **优雅降级**：在高负载期间调整分析深度

## 注意事项

1. **测试一致性**：测试模式始终返回标准化结果，确保测试的可预测性
2. **生产透明性**：生产环境详细记录配额限制情况，便于问题诊断
3. **用户体验**：即使在配额限制下，用户仍能获得基础的分析结果
4. **系统稳定性**：指数退避避免了对上游服务的持续压力 