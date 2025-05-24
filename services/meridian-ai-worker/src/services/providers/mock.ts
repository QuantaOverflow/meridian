import { AbstractProvider } from './base'
import { ProviderConfig, ModelConfig, AIRequest, AIResponse } from '../../types'

/**
 * Mock provider for testing and development
 * This provider simulates responses without making actual API calls
 */
export class MockProvider extends AbstractProvider {
  name = 'mock'
  config: ProviderConfig = {
    name: 'mock',
    base_url: 'http://localhost/mock',
    auth_header: 'Authorization',
    default_model: 'mock-chat',
    models: [
      {
        name: 'mock-chat',
        capabilities: ['chat'],
        endpoint: '/chat',
        max_tokens: 4096,
        supports_streaming: false,
        cost_per_token: { input: 0, output: 0 }
      },
      {
        name: 'mock-embedding',
        capabilities: ['embedding'],
        endpoint: '/embeddings',
        max_tokens: 8191,
        supports_streaming: false,
        cost_per_token: { input: 0, output: 0 }
      },
      {
        name: 'mock-image',
        capabilities: ['image'],
        endpoint: '/images',
        max_tokens: 0,
        supports_streaming: false,
        cost_per_token: { input: 0, output: 0 }
      }
    ]
  }

  constructor() {
    super('mock-api-key')
  }

  protected addProviderHeaders(
    headers: Record<string, string>, 
    request: AIRequest, 
    model: ModelConfig
  ): void {
    headers['X-Mock-Provider'] = 'true'
  }

  protected buildEndpointUrl(model: ModelConfig, request: AIRequest): string {
    return `${this.config.base_url}${model.endpoint}`
  }

  /**
   * Override buildRequest to create a mock request that won't be sent
   */
  buildRequest(request: AIRequest): any {
    const modelName = request.model || this.getDefaultModel(request.capability)
    if (!modelName) {
      throw new Error(`No model available for capability: ${request.capability}`)
    }

    const model = this.config.models.find(m => m.name === modelName)
    if (!model) {
      throw new Error(`Model not found: ${modelName}`)
    }

    // Return a mock gateway request
    return {
      provider: this.name,
      endpoint: this.buildEndpointUrl(model, request),
      headers: { 'Content-Type': 'application/json', 'X-Mock-Provider': 'true' },
      query: { mock: true, capability: request.capability }
    }
  }

  /**
   * Override to return mock response directly instead of making HTTP request
   */
  mapResponse(response: any, originalRequest: AIRequest): AIResponse {
    const modelName = originalRequest.model || this.getDefaultModel(originalRequest.capability)
    
    // Generate mock response based on capability
    switch (originalRequest.capability) {
      case 'chat':
        return {
          capability: 'chat',
          id: `chatcmpl-${Date.now()}`,
          provider: this.name,
          model: modelName || 'mock-chat',
          choices: [{
            message: {
              role: 'assistant',
              content: 'This is a mock response from the test provider. In a real scenario, this would be the AI response.'
            },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30
          }
        }

      case 'embedding':
        const dimensions = 1536 // Standard OpenAI embedding dimension
        const mockEmbedding = Array.from({ length: dimensions }, () => Math.random() * 2 - 1)
        
        return {
          capability: 'embedding',
          id: `embed-${Date.now()}`,
          provider: this.name,
          model: modelName || 'mock-embedding',
          data: [{
            embedding: mockEmbedding,
            index: 0
          }],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 0,
            total_tokens: 5
          }
        }

      case 'image':
        return {
          capability: 'image',
          id: `img-${Date.now()}`,
          provider: this.name,
          model: modelName || 'mock-image',
          data: [{
            url: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzMzNzNkYyIvPgogIDx0ZXh0IHg9IjUwIiB5PSI1NSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+TW9jazwvdGV4dD4KPC9zdmc+'
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 0,
            total_tokens: 10
          }
        }

      default:
        throw new Error(`Mock provider does not support capability: ${originalRequest.capability}`)
    }
  }
}
