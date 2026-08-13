import { 
  ChatRequest, 
  ChatResponse, 
  CapabilityHandler, 
  ModelConfig,
  ChatMessage
} from '../types'
import { isThinkingDisabled } from '../config/thinking'

export class ChatCapabilityHandler implements CapabilityHandler<ChatRequest, ChatResponse> {
  capability = 'chat' as const

  buildProviderRequest(request: ChatRequest, model: ModelConfig): any {
    // 确保max_tokens为正数且在合理范围内
    const requestedTokens = request.max_tokens ?? 1024
    const modelMaxTokens = model.max_tokens ?? 1024
    const maxTokens = Math.max(1, Math.min(requestedTokens, modelMaxTokens)) // 至少为1
    
    const baseRequest = {
      model: model.name,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: maxTokens,
      stream: request.stream ?? false
    }

    // Provider-specific formatting
    if (model.name.startsWith('gemini') || model.name.includes('gemini')) {
      // Google AI Studio / Gemini models
      const parts = request.messages.map(msg => ({
        text: msg.content
      }))

      return {
        contents: [{
          parts: parts
        }],
        generationConfig: {
          temperature: baseRequest.temperature,
          maxOutputTokens: Math.max(1, baseRequest.max_tokens), // 确保为正数
        }
      }
    } else if (model.name.split('/')[0] === '@cf') {
      // Workers AI models
      return {
        messages: request.messages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        max_tokens: baseRequest.max_tokens // Workers AI需要max_tokens字段
      }
    } else if (model.name.startsWith('claude')) {
      // Anthropic models
      // 不传 temperature：Claude 4.7+/Sonnet 5 对非默认采样参数直接 400
      return {
        model: model.name,
        max_tokens: baseRequest.max_tokens,
        messages: request.messages.filter(msg => msg.role !== 'system'),
        system: request.messages.find(msg => msg.role === 'system')?.content,
        stream: baseRequest.stream
      }
    } else {
      // OpenAI and compatible
      return baseRequest
    }
  }

  parseProviderResponse(response: any, request: ChatRequest, model: ModelConfig): ChatResponse {
    // Handle different provider response formats
    let choices: Array<{ message: ChatMessage, finish_reason: string }>
    let usage: any
    let id: string

    if (model.name.startsWith('gemini') || model.name.includes('gemini')) {
      // Google AI Studio / Gemini format
      const candidate = response.candidates?.[0]
      const content = candidate?.content?.parts?.[0]?.text || ''
      
      choices = [{
        message: {
          role: 'assistant' as const,
          content: content
        },
        finish_reason: candidate?.finishReason || 'stop'
      }]
      usage = {
        prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
        completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: response.usageMetadata?.totalTokenCount || 0
      }
      id = `gemini-${Date.now()}`
    } else if (model.name.startsWith('@cf')) {
      // Workers AI format：新模型（qwen3 / glm 等）返回 OpenAI 兼容格式（choices + usage，
      // 且 response 字段为 null），老模型（llama-2-7b 等）返回 { response: "..." }。
      // 另：REST /ai/run 多包一层 result，env.AI binding 直接返回内容——两者都兼容。
      const cfBody = response.result ?? response
      const cfChoice = cfBody.choices?.[0]
      const cfReasoning: string = cfChoice?.message?.reasoning_content ?? cfChoice?.message?.reasoning ?? ''
      let cfContent: string = cfChoice?.message?.content ?? cfBody.response ?? ''

      // 已显式关闭思维链的模型（见 config/thinking.ts），正文可能落在 reasoning 字段而非 content：
      // qwen3 关掉 thinking 后 content 恒为 null、完整 JSON 全在 reasoning_content 里
      // （2026-08-13 实测 23 篇 ×2 轮，content 非空 0/23 而 reasoning 里 9 字段齐全 23/23）。
      // 各家关掉 thinking 后的字段落位并不统一——GLM 关掉后正文照常进 content，走不到这条兜底。
      // **兜底必须限定在名单内**：思维链吃光 max_tokens 时同样是 content=null + 一堆 reasoning，
      // 无条件兜底会把那类真故障当正常输出放行，正是下面那段"响亮地失败"要防的事。
      if (!cfContent && cfReasoning && isThinkingDisabled(model.name)) {
        cfContent = cfReasoning
      }

      // 空正文必须响亮地失败，不能 `?? ''` 悄悄放行。reasoning 模型（GLM）在 max_tokens 被
      // 思维链吃光时返回 content=null，而 HTTP 层看起来完全正常（200 + 完整 JSON + usage）——
      // 静默降级成空串后，下游 JSON 解析拿到 null 再兜底成默认值，故障要到简报缺内容才暴露。
      // 抛错让上层既有的重试/兜底机制接管，并把判定所需的证据（reasoning 长度、finish_reason）
      // 一并带出：这正是当初只靠客户端返回码判断时看不见的那部分。
      if (!cfContent) {
        const reasoningLen = cfReasoning.length
        throw new Error(
          `Workers AI 返回空正文 (model=${model.name}, finish_reason=${cfChoice?.finish_reason}, ` +
          `reasoning=${reasoningLen}字符, completion_tokens=${cfBody.usage?.completion_tokens})` +
          (reasoningLen > 0 ? ' —— 思维链占满了 max_tokens，检查该模型是否已关闭 thinking' : '')
        )
      }
      choices = [{
        message: {
          role: 'assistant' as const,
          content: cfContent
        },
        finish_reason: cfChoice?.finish_reason || 'stop'
      }]
      usage = cfBody.usage
      id = cfBody.id || `chatcmpl-${Date.now()}`
    } else if (model.name.startsWith('claude')) {
      // Anthropic format
      choices = [{
        message: {
          role: 'assistant' as const,
          content: response.content?.[0]?.text || ''
        },
        finish_reason: response.stop_reason || 'stop'
      }]
      usage = {
        prompt_tokens: response.usage?.input_tokens,
        completion_tokens: response.usage?.output_tokens,
        total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
      }
      id = response.id || `msg_${Date.now()}`
    } else {
      // OpenAI format (default)
      choices = response.choices || []
      usage = response.usage
      id = response.id || `chatcmpl-${Date.now()}`
    }

    // Determine provider based on model name
    let provider: string
    if (model.name.startsWith('gemini') || model.name.includes('gemini')) {
      provider = 'google-ai-studio'
    } else if (model.name.split('/')[0] === '@cf') {
      provider = 'workers-ai'
    } else if (model.name.startsWith('claude')) {
      provider = 'anthropic'
    } else {
      provider = 'openai'
    }

    return {
      capability: 'chat',
      id,
      provider,
      model: model.name,
      choices,
      usage,
      cached: response.cached
    }
  }
}
