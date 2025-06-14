# Meridian Backend 测试指南

## 测试概述

本项目使用 Vitest 和 @cloudflare/vitest-pool-workers 进行 Cloudflare Workers 环境的测试。

## 测试结构

### 主要测试文件

- `example.test.ts` - 综合测试文件，包含所有核心功能测试

### 测试覆盖范围

1. **基本单元测试**
   - Worker 基本路由处理 (ping, 404)
   - CORS 预检请求处理

2. **集成测试**
   - 使用 SELF 进行端到端测试
   - 健康检查端点测试

3. **工具函数测试**
   - `hasValidAuthToken` - API 认证逻辑
   - `generateSearchText` - 搜索文本生成

4. **RSS 解析器测试**
   - 正常 RSS 解析
   - 错误输入处理

5. **错误处理测试**
   - 恶意请求处理
   - 大型请求体处理

6. **环境测试**
   - 环境变量访问
   - 绑定可用性检查

7. **性能测试**
   - 响应时间基准
   - 顺序请求处理

## 配置文件

### vitest.config.ts
- 简化的 Vitest 配置
- 使用 @cloudflare/vitest-pool-workers
- 禁用文件并行执行以避免资源冲突

### wrangler.test.jsonc
- 测试专用的 Wrangler 配置
- 包含必要的 Durable Objects migrations
- 简化的绑定配置以避免冲突

## 运行测试

```bash
npm test
```

## 测试策略

由于 Cloudflare Workers 测试环境的限制，我们采用以下策略：

1. **单一测试文件**: 将所有测试合并到一个文件中，避免多文件间的资源冲突
2. **顺序执行**: 禁用并行执行，确保测试稳定性
3. **简化配置**: 最小化绑定配置，减少启动错误
4. **模拟优先**: 对复杂依赖使用模拟而非真实绑定

## 备份测试文件

`test_backup/` 目录中包含原始的独立测试文件：
- `utils.spec.ts` - 工具函数测试
- `parseRss.spec.ts` - RSS 解析测试
- `parseArticle.spec.ts` - 文章解析测试
- `rateLimiter.spec.ts` - 速率限制测试
- `api-endpoint-test.js` - API 端点测试

这些文件由于 Workers 环境限制暂时不能同时运行，但代码已整合到主测试文件中。

## 故障排除

### 常见问题

1. **"inserted row already exists in table"**: 多个测试文件冲突，使用单一测试文件
2. **兼容性日期错误**: 确保使用支持的日期 (2025-04-17)
3. **Durable Objects 错误**: 确保配置了正确的 migrations

### 测试最佳实践

1. 保持测试文件数量最少
2. 使用模拟替代复杂的实际绑定
3. 测试核心业务逻辑而非基础设施
4. 确保测试具有确定性和可重复性 