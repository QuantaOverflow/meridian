# Meridian AI Worker - Gemini API 更新摘要

## 📅 更新日期
2025年5月30日

## 🎯 更新目标
根据最新的 Gemini API 文档，更新 meridian-ai-worker 项目以支持最新的 Google AI 模型和功能。

## 🚀 新增模型

### Gemini 2.5 系列（实验性思考型模型）
- **gemini-2.5-pro-preview**: 最强大的思考型模型，具有复杂推理能力
- **gemini-2.5-flash-preview**: 性价比最高的思考型模型，支持思考预算配置
- **gemini-2.5-flash-native-audio**: 原生音频处理能力
- **gemini-2.5-flash-text-to-speech**: 专用文本转语音模型
- **gemini-2.5-pro-text-to-speech**: 高质量文本转语音模型

### Gemini 2.0 系列（新一代多模态模型）
- **gemini-2.0-flash**: 新一代多模态模型，支持代码生成、图像生成、数据分析等
- **gemini-2.0-flash-image-generation**: 专用原生图像生成
- **gemini-2.0-flash-lite**: 最快、最具成本效益的轻量版本
- **gemini-2.0-flash-live**: 低延迟双向语音和视频交互

### 专用生成模型
- **imagen-3.0-generate-002**: 最先进的图像生成模型
- **veo-2.0-generate-001**: 高质量视频生成模型
- **gemini-embedding-exp**: 实验性嵌入模型

## 🔧 新增功能

### 1. AI 能力扩展
新增支持的能力类型：
- `video`: 视频生成
- `text-to-speech`: 文本转语音
- `speech-to-text`: 语音转文本
- `live-audio`: 实时音频交互
- `live-video`: 实时视频交互

### 2. 请求/响应类型
- `VideoRequest` & `VideoResponse`: 视频生成功能
- `TextToSpeechRequest` & `TextToSpeechResponse`: 文本转语音功能
- `SpeechToTextRequest` & `SpeechToTextResponse`: 语音转文本功能
- `LiveAudioRequest` & `LiveAudioResponse`: 实时音频交互
- `LiveVideoRequest` & `LiveVideoResponse`: 实时视频交互

### 3. 新增能力处理器
- `VideoCapability`: 处理视频生成请求
- `TextToSpeechCapability`: 处理文本转语音请求
- `LiveAudioCapability`: 处理实时音频交互

### 4. 新增 API 端点
- `POST /meridian/video/generate`: 视频生成
- `POST /meridian/tts/generate`: 文本转语音
- `POST /meridian/live/audio`: 实时音频交互
- 更新的图像生成端点支持 Imagen 3.0

## 📊 性能优化

### 默认模型更新
- 将默认模型从 `gemini-1.5-flash-8b-001` 更新为 `gemini-2.0-flash`
- 提供更好的多模态支持和性能

### 成本效益优化
- **高频任务**: 推荐使用 `gemini-2.0-flash-lite`（最低成本）
- **标准任务**: 推荐使用 `gemini-2.0-flash`（平衡性能与成本）
- **高质量任务**: 推荐使用 `gemini-2.5-pro-preview`（最强性能）

### 流式处理支持
- 为所有 Gemini 1.5 和 2.x 模型启用流式处理
- 提升用户体验和响应速度

## 🔄 向后兼容性

### 保持兼容
- 所有现有的 Gemini 1.5 和 1.0 模型继续支持
- 现有的 API 端点和请求格式保持不变
- 现有的能力处理器继续工作

### 平滑迁移
- 推荐逐步迁移到新模型
- 提供模型选择指南和最佳实践
- 支持 A/B 测试不同模型性能

## 🎨 特色功能

### 原生图像生成
- Gemini 2.0 Flash 支持原生图像生成和编辑
- 与对话无缝集成，支持上下文相关的图像创建

### 长上下文处理
- 支持数百万个令牌的长上下文输入
- 能够分析大型数据库、代码库和文档

### 结构化输出
- 支持 JSON 格式的结构化响应
- 适合自动化处理和数据提取

### 实时交互
- 低延迟的双向语音和视频交互
- 支持多种音频格式和编码

## 📋 使用建议

### 推荐用途
1. **文章分析**: 使用 `gemini-2.0-flash` 或 `gemini-2.5-pro-preview`
2. **批量处理**: 使用 `gemini-2.0-flash-lite`
3. **图像生成**: 使用 `imagen-3.0-generate-002` 或 `gemini-2.0-flash`
4. **视频生成**: 使用 `veo-2.0-generate-001`
5. **语音处理**: 使用 `gemini-2.5-flash-text-to-speech`
6. **实时交互**: 使用 `gemini-2.0-flash-live`

### 注意事项
- 实验性模型（2.5 系列）可能有更严格的速率限制
- 视频和图像生成成本较高，建议合理使用
- 实时交互功能不使用缓存，成本考量需要特别注意

## 🔜 后续计划

1. **性能监控**: 监控新模型的性能和成本效益
2. **功能测试**: 为新功能添加全面的测试覆盖
3. **用户反馈**: 收集用户使用新功能的反馈
4. **文档完善**: 补充详细的使用示例和最佳实践

---

**更新负责人**: AI Assistant  
**版本**: v3.0.0  
**状态**: 已完成基础更新，待测试验证 