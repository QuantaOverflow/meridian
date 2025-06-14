# Meridian Backend 测试指南

## 测试概述

本项目使用 Vitest 和 @cloudflare/vitest-pool-workers 进行 Cloudflare Workers 环境的测试。

## 测试结构

### 主要测试文件

- `example.test.ts` - 综合测试文件，包含所有核心功能测试
- `parseRss.spec.ts` - RSS 解析专项测试，使用 fixtures 模块

### Fixtures 系统

由于 Cloudflare Workers 环境不支持 `fs.readFileSync`，我们开发了一个 fixtures 模块系统：

#### 生成 Fixtures

```bash
npm run generate-fixtures
```

这个命令会：
1. 读取 `test/fixtures/*.xml` 中的所有测试文件
2. 生成 `test/fixtures.ts` 模块文件
3. 将文件内容作为字符串常量导出

#### 使用 Fixtures

```typescript
import { fixtures } from './fixtures';

// 使用生成的 fixtures
const result = await parseRSSFeed(fixtures.independant_co_uk);
```

#### 可用的 Fixtures

- `fixtures.independant_co_uk` - The Independent RSS feed
- `fixtures.cn_nytimes_com` - 纽约时报中文网 RSS feed  
- `fixtures.ft_com` - Financial Times RSS feed
- `fixtures.theverge_com` - The Verge Atom feed

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
   - 正常 RSS 解析（多种格式）
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

### 推荐方式 (无资源冲突)
```bash
npm run test:safe
```

### 传统方式 (可能有资源冲突)
```bash
npm test
```

### 运行单个测试文件
```bash
npm test -- test/example.test.ts
npm test -- test/parseRss.spec.ts
```

### 重新生成 Fixtures
```bash
npm run generate-fixtures
```

## 测试策略

由于 Cloudflare Workers 测试环境的限制，我们采用以下策略：

1. **Fixtures 模块**: 将测试数据转换为 TypeScript 模块，避免文件系统依赖
2. **顺序执行**: 禁用并行执行，确保测试稳定性
3. **简化配置**: 最小化绑定配置，减少启动错误
4. **模拟优先**: 对复杂依赖使用模拟而非真实绑定

## 添加新的测试数据

1. 将新的 XML 文件放入 `test/fixtures/` 目录
2. 运行 `npm run generate-fixtures` 重新生成 fixtures 模块
3. 在测试中使用 `fixtures.your_new_fixture_name`

## 故障排除

### 常见问题

1. **"Cannot use require() to import an ES Module"**: 使用 fixtures 模块系统替代文件读取
2. **"No such module" 错误**: 确保运行了 `npm run generate-fixtures`
3. **兼容性日期错误**: 确保使用支持的日期 (2025-04-17)
4. **Durable Objects 错误**: 确保配置了正确的 migrations

### 测试最佳实践

1. 使用 fixtures 模块替代文件系统访问
2. 保持测试具有确定性和可重复性
3. 使用模拟替代复杂的实际绑定
4. 测试核心业务逻辑而非基础设施 