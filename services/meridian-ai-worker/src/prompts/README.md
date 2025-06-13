# Prompts 目录

本目录包含 meridian-ai-worker 中所有的 AI 提示词模板，旨在提高代码的可读性和可维护性。

## 文件结构

### 核心业务 Prompts

- **`articleAnalysis.ts`** - 文章分析提示词
  - 用于分析文章内容，提取语义信息和结构化数据
  - 被 `/meridian/analyze` 和 `/meridian/article/analyze` 端点使用

- **`storyValidation.ts`** - 故事验证提示词  
  - 用于验证文章聚类是否构成一个连贯的故事
  - 被 `/meridian/story/validate` 端点使用

- **`intelligenceAnalysis.ts`** - 情报分析提示词
  - 用于深度分析故事聚类，生成结构化情报报告
  - 被 `IntelligenceService.analyzeStory()` 方法使用

### 简报生成 Prompts

- **`briefGeneration.ts`** - 简报生成提示词集合
  - `getBriefGenerationSystemPrompt()` - 系统提示词，定义分析师角色和要求
  - `getBriefGenerationPrompt()` - 主要简报生成提示词
  - `getBriefTitlePrompt()` - 简报标题生成提示词
  - 被 `/meridian/generate-final-brief` 端点使用

- **`tldrGeneration.ts`** - TLDR 生成提示词
  - 用于生成简报的简要概览，便于后续参考
  - 被 `/meridian/generate-brief-tldr` 端点使用

## 重构目的

1. **可读性提升** - 将长的 prompt 字符串从业务逻辑中分离
2. **可维护性** - 集中管理所有提示词，便于更新和版本控制  
3. **复用性** - 提示词可以在多个地方复用
4. **测试友好** - 独立的提示词函数更容易进行单元测试

## 使用方式

```typescript
// 直接导入需要的函数
import { getArticleAnalysisPrompt } from './prompts/articleAnalysis'
import { getBriefGenerationPrompt } from './prompts/briefGeneration'

// 或者使用统一导出
import { getArticleAnalysisPrompt, getBriefGenerationPrompt } from './prompts'

// 使用提示词
const prompt = getArticleAnalysisPrompt(title, content)
const briefPrompt = getBriefGenerationPrompt(storiesMarkdown, previousContext)
```

## 开发指南

- 新增提示词时，请创建对应的文件并添加到 `index.ts` 中导出
- 提示词函数应该接受必要的参数，返回完整的提示词字符串
- 建议添加 JSDoc 注释说明提示词的用途和参数
- 保持与 reportV5.md 文档的一致性 