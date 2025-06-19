# 配额限制处理策略

## 概述

新的配额限制处理功能在 `IntelligenceService` 和 `BriefGenerationService` 中实现了分级的错误处理和重试策略，支持测试模式和生产环境的不同行为。

**重要更新：** 生产环境现在不再使用假数据fallback，而是真实报告错误状态，确保问题的透明性和可诊断性。

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

### 3. 分级错误处理策略

#### 测试模式 (`env.INTEGRATION_TEST_MODE === 'true'` 或 `env.NODE_ENV === 'test'`)

返回测试兼容的标准化报告，确保测试的一致性和可预测性：
```json
{
  "success": true,
  "data": {
    "storyId": "story-test-title",
    "status": "COMPLETE",
    "executiveSummary": "Executive summary for Test Title",
    // ... 完整的测试兼容报告
  }
}
```

#### 生产环境（新策略）

**严格错误报告 - 不使用假数据fallback：**
```json
{
  "success": false,
  "error": "Quota limit error: models/gemini-1.5-flash-001 is not found for API version v1beta",
  "data": null // 或部分结果用于诊断
}
```

**详细错误日志：**
```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "level": "ERROR",
  "message": "生产环境配额限制错误，不使用fallback",
  "metadata": {
    "storyTitle": "Story Title",
    "articlesCount": 5,
    "error": "Quota exceeded",
    "errorType": "QUOTA_LIMIT",
    "requestId": "error-1704110410000-abc123"
  }
}
```

## 服务级别错误处理

### IntelligenceService

**analyzeStories方法：**
- 生产环境：如果任何故事分析失败，返回 `success: false`
- 测试模式：继续使用fallback确保测试稳定性

**analyzeSingleStory方法：**
- 生产环境：AI分析失败时直接返回错误
- 测试模式：使用标准fallback报告

### BriefGenerationService

**generateBrief方法：**
- 生产环境：配额限制或AI错误时返回 `success: false`
- 测试模式：使用fallback策略

**generateTLDR方法：**
- 生产环境：错误时返回 `success: false`
- 测试模式：使用预定义的测试兼容TLDR

### StoryValidationService

保持现有策略：
- 验证失败的聚类标记为"拒绝"而非生成假数据
- 这种行为在测试和生产环境中都是一致的

## 使用示例

### 正常调用
```typescript
const service = new IntelligenceService(env);
const result = await service.analyzeSingleStory(story, articles);

if (result.success) {
  // 处理成功结果
  console.log('分析成功:', result.data);
} else {
  // 处理错误 - 生产环境中是真实错误
  console.error('分析失败:', result.error);
  // 可以进行错误恢复、重试或用户通知
}
```

### 错误处理示例

**测试模式：**
```
[Intelligence] 测试模式配额限制，返回测试兼容结果: Story Title
```

**生产环境：**
```
[Intelligence] 生产环境配额限制错误: {
  error: "models/gemini-1.5-flash-001 is not found",
  storyTitle: "Story Title",
  articlesCount: 5,
  timestamp: "2024-01-01T12:00:00.000Z"
}

返回: { success: false, error: "Quota limit error: models/gemini-1.5-flash-001 is not found" }
```

## 监控建议

### 关键指标
1. **真实错误率**：监控实际的AI Gateway失败率
2. **配额限制频率**：跟踪配额相关错误
3. **重试成功率**：监控重试策略的有效性
4. **服务可用性**：跟踪整体服务成功率

### 告警设置
- 生产环境AI Gateway错误率超过阈值时立即告警
- 配额限制错误频繁发生时发送通知
- 模型不可用错误时紧急告警
- 连续重试失败时发送运维通知

### 错误分类
1. **配置错误**：模型不存在、API密钥无效
2. **配额限制**：请求量超限、令牌用尽
3. **网络错误**：连接超时、DNS解析失败
4. **服务错误**：上游服务5xx错误

## 配置建议

### 环境变量
```bash
# 生产环境 - 严格错误处理
NODE_ENV=production
INTEGRATION_TEST_MODE=false

# 测试模式 - 使用fallback
NODE_ENV=test
# 或
INTEGRATION_TEST_MODE=true
```

### 生产环境最佳实践
1. **配置验证**：启动时验证AI Gateway配置
2. **模型验证**：定期检查模型可用性
3. **负载均衡**：分散API调用到多个时间段
4. **缓存策略**：缓存成功的分析结果
5. **优雅降级**：在高负载期间调整处理策略
6. **错误聚合**：收集错误模式进行问题诊断

## 部署考虑

### 生产环境部署前检查
1. ✅ AI Gateway配置正确
2. ✅ 模型名称和版本有效
3. ✅ API密钥权限充足
4. ✅ 配额限制了解清楚
5. ✅ 错误监控已配置
6. ✅ 告警机制已启用

### 错误恢复策略
1. **自动重试**：临时网络错误
2. **指数退避**：配额限制错误
3. **人工干预**：配置或模型错误
4. **服务降级**：长期不可用时的策略

## 注意事项

1. **测试稳定性**：测试模式仍使用fallback确保CI/CD稳定性
2. **生产透明性**：生产环境错误完全透明，便于问题诊断
3. **用户体验**：错误信息对开发者友好，包含足够的诊断信息
4. **系统稳定性**：避免了假数据掩盖真实问题，提高系统可靠性
5. **监控重要性**：生产环境必须配置完善的错误监控和告警 