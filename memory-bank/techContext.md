# Tech Context - Meridian

## 技术栈概览

### 基础设施
- **云平台**: Cloudflare (Workers, Pages, Workflows, R2, D1)
- **计算**: Cloudflare Workers (Edge computing)
- **存储**: PostgreSQL (主数据库), Cloudflare R2 (对象存储)
- **缓存**: Cloudflare边缘缓存
- **DNS**: Cloudflare DNS

### 后端技术栈
- **运行时**: Node.js v22+
- **框架**: Hono (轻量级Web框架)
- **语言**: TypeScript 5.8.2
- **数据库**: PostgreSQL + Drizzle ORM
- **API**: RESTful APIs
- **验证**: Zod schema validation
- **部署**: Wrangler (Cloudflare Workers CLI)

### 前端技术栈
- **框架**: Nuxt 3 (Vue 3 + SSR)
- **语言**: TypeScript + Vue 3 Composition API
- **样式**: Tailwind CSS v4
- **UI组件**: 
  - Headless UI (Vue)
  - Heroicons
  - Radix UI Colors
- **路由**: Vue Router 4
- **部署**: Cloudflare Pages

### AI/ML技术栈
- **AI服务**: Google AI (Gemini 2.0 Flash, Gemini 2.5 Pro)
- **AI SDK**: @ai-sdk/google, @cloudflare/ai
- **嵌入模型**: multilingual-e5-small
- **聚类**: UMAP + HDBSCAN (Python)
- **向量处理**: Python NumPy, Scikit-learn

### 开发工具
- **包管理**: pnpm v10.9.0
- **构建工具**: Turborepo (Monorepo管理)
- **代码质量**: 
  - TypeScript strict mode
  - Prettier (代码格式化)
  - ESLint (代码检查)
- **测试**: Vitest (单元测试)
- **版本控制**: Git + GitHub

## 关键依赖分析

### 后端核心依赖
```json
{
  "@ai-sdk/google": "^1.2.13",          // Google AI集成
  "@cloudflare/ai": "^1.2.2",          // Cloudflare AI
  "@cloudflare/puppeteer": "^1.0.2",   // 浏览器自动化
  "@hono/zod-validator": "^0.4.3",     // API验证
  "@mozilla/readability": "^0.6.0",    // 内容提取
  "hono": "^4.7.7",                    // Web框架
  "fast-xml-parser": "^5.2.1",         // RSS解析
  "linkedom": "^0.18.9",               // DOM操作
  "neverthrow": "^8.2.0",              // 错误处理
  "zod": "^3.24.3"                     // Schema验证
}
```

### 前端核心依赖
```json
{
  "nuxt": "^3.16.2",                   // 主框架
  "vue": "^3.5.13",                   // 前端框架
  "@headlessui/vue": "^1.7.23",       // UI组件
  "@heroicons/vue": "^2.2.0",         // 图标
  "tailwindcss": "^4.1.4",            // CSS框架
  "markdown-it": "^14.1.0",           // Markdown渲染
  "date-fns": "^4.1.0"                // 日期处理
}
```

### Python ML 依赖
- **UMAP**: 降维算法
- **HDBSCAN**: 聚类算法
- **scikit-learn**: 机器学习工具
- **numpy**: 数值计算
- **pandas**: 数据处理

## 开发环境配置

### 必需的环境变量
```bash
# Google AI API
GOOGLE_AI_API_KEY=your_key_here

# 数据库连接
DATABASE_URL=postgresql://...

# Cloudflare配置
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token

# 应用配置
NODE_ENV=development
API_BASE_URL=http://localhost:8787
```

### 本地开发设置
1. **Node.js版本**: v22+ (使用nvm管理)
2. **包管理器**: pnpm v10.9.0
3. **Python版本**: 3.10+ (用于ML服务)
4. **数据库**: PostgreSQL本地实例
5. **Cloudflare账户**: 用于Workers开发

### 开发工作流
```bash
# 安装依赖
pnpm install

# 数据库迁移
pnpm --filter @meridian/database migrate

# 开发模式
pnpm dev

# 类型检查
pnpm typecheck

# 代码格式化
pnpm format

# 构建生产版本
pnpm build
```

## 技术约束

### Cloudflare Workers限制
- **执行时间**: 最大10秒 (paid plan 30秒)
- **内存限制**: 128MB
- **请求大小**: 最大100MB
- **并发连接**: 有限的数据库连接
- **CPU密集任务**: 不适合长时间计算

### 数据库约束
- **连接数**: 有限的并发连接
- **查询复杂度**: 避免过于复杂的JOIN操作
- **数据大小**: 考虑存储成本

### AI服务约束
- **API速率限制**: Google AI API的调用频率限制
- **上下文长度**: 模型最大token限制
- **成本控制**: AI API调用成本管理
- **延迟**: 外部API调用延迟

### 前端约束
- **SEO**: SSR/SSG优化需求
- **性能**: 移动设备性能考虑
- **浏览器兼容性**: 现代浏览器支持

## 性能考虑

### 后端性能
- **Edge计算**: 利用Cloudflare全球网络
- **缓存策略**: 多层缓存设计
- **数据库优化**: 索引和查询优化
- **API响应**: 快速API响应时间

### 前端性能
- **代码分割**: Dynamic imports
- **资源优化**: 图片和字体优化
- **缓存**: 浏览器和CDN缓存
- **首屏时间**: Core Web Vitals优化

### AI/ML性能
- **批处理**: 批量AI请求处理
- **模型选择**: 根据任务选择合适模型
- **缓存结果**: AI分析结果缓存
- **异步处理**: 后台AI任务处理

## 监控和调试

### 应用监控
- **错误跟踪**: Cloudflare Workers监控
- **性能监控**: API响应时间跟踪
- **资源使用**: 内存和CPU使用监控

### 调试工具
- **本地开发**: Wrangler dev模式
- **日志**: 结构化日志记录
- **测试**: 单元测试和集成测试

## 部署和DevOps

### 部署流程
1. **代码提交**: Git push触发CI/CD
2. **自动构建**: GitHub Actions构建
3. **测试**: 自动化测试执行
4. **部署**: Wrangler自动部署

### 环境管理
- **开发环境**: 本地开发
- **预生产环境**: Cloudflare staging
- **生产环境**: Cloudflare production

### 版本管理
- **语义化版本**: SemVer版本控制
- **发布策略**: Feature branches + PR
- **回滚策略**: 快速回滚机制 