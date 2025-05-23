
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
    const baseRequest = {
      model: model.name,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: Math.min(request.max_tokens ?? 1024, model.max_tokens ?? 1024),
      stream: request.stream ?? false
    }

    // Provider-specific formatting
    switch (model.name.split('/')[0]) {
      case '@cf': // Workers AI models
        return {
          messages: request.messages.map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        }
      
      case 'claude': // Anthropic models
        return {
          model: model.name,
          max_tokens: baseRequest.max_tokens,
          temperature: baseRequest.temperature,
          messages: request.messages.filter(msg => msg.role !== 'system'),
          system: request.messages.find(msg => msg.role === 'system')?.content,
          stream: baseRequest.stream
        }
      
      default: // OpenAI and compatible
        return baseRequest
    }
  }

  parseProviderResponse(response: any, request: ChatRequest, model: ModelConfig): ChatResponse {
    // Handle different provider response formats
    let choices: Array<{ message: ChatMessage, finish_reason: string }>
    let usage: any
    let id: string

    if (model.name.startsWith('@cf')) {
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

    return {
      capability: 'chat',
      id,
      provider: model.name.split('/')[0] === '@cf' ? 'workers-ai' : 
                model.name.startsWith('claude') ? 'anthropic' : 'openai',
      model: model.name,
      choices,
      usage,
      cached: response.cached
    }
  }
}
