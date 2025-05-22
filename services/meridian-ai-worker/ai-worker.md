# Meridian AI Worker

> **Cloudflare Workers Unified AI API Gateway**

---

## 项目简介

Meridian AI Worker 是一个基于 Cloudflare Workers 的统一 AI API 网关，支持 OpenAI、Google Gemini、Anthropic Claude 以及 Cloudflare 自有模型。它为多模型、多供应商的 AI 能力提供统一的 API 接入、鉴权、模型路由与错误处理，适用于需要灵活切换/聚合多家大模型服务的场景。

---

## 主要特性

- **多供应商支持**：一套 API 同时支持 OpenAI、Google Gemini、Anthropic Claude、Cloudflare AI Gateway。
- **统一鉴权**：支持 Cloudflare AI Gateway 的 `cf-aig-authorization`，并自动处理各家厂商的 API Key/Token。
- **智能模型路由**：根据用户请求自动选择目标模型与供应商。
- **灵活模型注册**：通过 `modelRegistry.ts` 配置支持自定义模型与端点。
- **详细错误处理**：标准化错误响应，便于前端和调用方处理。
- **API 文档自动生成**：内置 `/docs` 路由，输出 Markdown 格式的 API 文档。
- **可扩展架构**：易于新增模型供应商或自定义业务逻辑。

---

## 架构概览

```mermaid
graph TD
  Client
    -->|RESTful API (统一接口)| MeridianAIWorker[Meridian AI Worker (Cloudflare Workers)]
  MeridianAIWorker -->|Provider 路由与鉴权| Provider[OpenAI / Google / Anthropic / Cloudflare]
  MeridianAIWorker -->|Model Registry| ModelRegistry[模型注册与映射]
  MeridianAIWorker -->|Task Service| TaskService[请求分发与异步任务]
  MeridianAIWorker -->|Response Parser| ResponseParser[标准化响应]
  Provider -->|API 调用| AIProviders[各大模型 API (OpenAI, Google Gemini, Claude, Cloudflare AI Gateway)]
```

---

## 目录结构（核心部分）

- `src/gateway/aiGatewayClient.ts` —— AI Gateway 请求与鉴权逻辑
- `src/gateway/taskService.ts` —— 任务分发与异步处理
- `src/config/modelRegistry.ts` —— 模型注册与端点映射
- `src/router/gatewayRouter.ts` —— API 路由与入口
- `src/gateway/responseParser.ts` —— 响应标准化
- `src/gateway/serviceFactory.ts` —— 供应商服务工厂
- `src/types.ts` —— 类型定义

---

## 统一 API 设计

### 1. 通用请求格式

- `POST /v1/chat/completions` —— 聊天/对话
- `POST /v1/completions` —— 通用文本生成
- `POST /v1/embeddings` —— 向量/嵌入生成

#### 请求参数（示例）

```json
{
  "model": "gpt-3.5-turbo", // 或 "gemini-pro", "claude-3-opus", "@cf/meta/llama-2-7b-chat-fp16"
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "provider": "openai" // 可选: openai | google | anthropic | cloudflare
}
```

#### 鉴权方式

- Cloudflare AI Gateway: `cf-aig-authorization: <token>`
- OpenAI: `Authorization: Bearer <api-key>`
- Google Gemini: `x-goog-api-key: <api-key>`
- Anthropic: `x-api-key: <api-key>`

> **注意**：如通过 Cloudflare AI Gateway 代理 Google Gemini，需将 `provider` 设为 `google`，Worker 会自动映射为 `google-ai-studio` 并处理鉴权。

### 2. 响应格式

- 成功：

```json
{
  "id": "...",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "gpt-3.5-turbo",
  "choices": [...],
  "usage": {...}
}
```

- 失败：

```json
{
  "error": {
    "message": "Invalid provider",
    "type": "invalid_request_error",
    "code": 400
  }
}
```

---

## 关键实现说明

### 1. Provider 映射与鉴权

- `aiGatewayClient.ts` 内部自动将 `google` provider 映射为 `google-ai-studio`，以兼容 Cloudflare AI Gateway。
- 所有请求均自动附加 `cf-aig-authorization`（如配置），并根据目标 provider 附加对应的 API Key Header。

### 2. 模型注册与端点

- `modelRegistry.ts` 统一维护所有支持模型及其 endpoint 格式。
- Google Gemini 端点格式为 `v1/models/{model}:{operation}`，已适配 Cloudflare Gateway 要求。

### 3. 错误处理

- 统一捕获并标准化所有下游 API 错误，返回结构化错误信息，便于前端处理。
- 日志增强，便于排查请求链路问题。

### 4. API 文档自动生成

- `/docs` 路由自动输出 Markdown 格式的 API 说明，便于集成与二次开发。

---

## 快速开始

1. **配置环境变量**（`.env`）：
   - `OPENAI_API_KEY`、`GOOGLE_API_KEY`、`ANTHROPIC_API_KEY`、`CF_AIG_AUTHORIZATION` 等
2. **部署到 Cloudflare Workers**：
   - 配置 `wrangler.toml`，运行 `npx wrangler deploy`
3. **调用 API**：
   - 参考上文统一 API 设计

---

## 未来规划

- 支持更多 AI 供应商（如 Baidu、阿里、智谱等）
- 增加流式输出、异步任务队列
- 丰富 API 文档与在线测试
- 更细粒度的权限与配额管理
- 多租户与自定义模型注册

---

## 参考与致谢

- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [OpenAI API](https://platform.openai.com/docs/api-reference)
- [Google Gemini API](https://ai.google.dev/gemini-api/docs)
- [Anthropic Claude API](https://docs.anthropic.com/claude/reference)

---

> 如需贡献或反馈建议，请提交 Issue 或 PR。
