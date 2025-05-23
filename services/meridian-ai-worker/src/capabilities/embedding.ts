
import { 
  EmbeddingRequest, 
  EmbeddingResponse, 
  CapabilityHandler, 
  ModelConfig 
} from '../types'

export class EmbeddingCapabilityHandler implements CapabilityHandler<EmbeddingRequest, EmbeddingResponse> {
  capability = 'embedding' as const

  buildProviderRequest(request: EmbeddingRequest, model: ModelConfig): any {
    const baseRequest = {
      model: model.name,
      input: request.input,
      dimensions: request.dimensions
    }

    // Provider-specific formatting
    switch (model.name.split('/')[0]) {
      case '@cf': // Workers AI models
        return {
          text: Array.isArray(request.input) ? request.input : [request.input]
        }
      
      default: // OpenAI and compatible
        return baseRequest
    }
  }

  parseProviderResponse(response: any, request: EmbeddingRequest, model: ModelConfig): EmbeddingResponse {
    let data: Array<{ embedding: number[], index: number }>
    let usage: any
    let id: string

    if (model.name.startsWith('@cf')) {
      // Workers AI format
      const embeddings = response.result?.data || response.data || []
      data = embeddings.map((embedding: number[], index: number) => ({
        embedding,
        index
      }))
      usage = undefined
      id = `embed-${Date.now()}`
    } else {
      // OpenAI format (default)
      data = response.data || []
      usage = response.usage
      id = response.id || `embed-${Date.now()}`
    }

    return {
      capability: 'embedding',
      id,
      provider: model.name.split('/')[0] === '@cf' ? 'workers-ai' : 'openai',
      model: model.name,
      data,
      usage,
      cached: response.cached
    }
  }
}
