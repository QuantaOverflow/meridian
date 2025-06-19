import { 
  ChatRequest, 
  ChatResponse, 
  CapabilityHandler, 
  ModelConfig,
  ChatMessage 
} from '../types'

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
      return {
        model: model.name,
        max_tokens: baseRequest.max_tokens,
        temperature: baseRequest.temperature,
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
      // Workers AI format
      choices = [{
        message: {
          role: 'assistant' as const,
          content: response.result?.response || response.response || ''
        },
        finish_reason: 'stop'
      }]
      usage = undefined
      id = `chatcmpl-${Date.now()}`
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
