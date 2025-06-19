
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
        // Special handling for BGE-M3 which supports multiple input formats
        if (model.name === '@cf/baai/bge-m3') {
          // BGE-M3 supports two input formats:
          // 1. Query and contexts (for search/reranking)
          // 2. Text embedding (standard embedding)
          
          if (request.query && request.contexts) {
            // Query and contexts format for search/ranking
            return {
              query: request.query,
              contexts: request.contexts,
              truncate_inputs: request.truncate_inputs ?? true
            }
          } else {
            // Standard text embedding format
            return {
              text: Array.isArray(request.input) ? request.input : [request.input],
              truncate_inputs: request.truncate_inputs ?? true
            }
          }
        }
        // For BGE-small-en-v1.5 and other standard embedding models
        else if (model.name === '@cf/baai/bge-small-en-v1.5') {
          return {
            text: Array.isArray(request.input) ? request.input : [request.input]
          }
        }
        // For other Workers AI embedding models
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
      if (model.name === '@cf/baai/bge-m3') {
        // BGE-M3 specific response format
        // BGE-M3 can return different formats based on input type
        
        if (response.result?.response && Array.isArray(response.result.response)) {
          // Query and contexts response format: array of {id, score}
          const queryResults = response.result.response
          data = queryResults.map((result: any, index: number) => ({
            embedding: [], // Query responses don't contain embeddings, only scores
            index,
            score: result.score,
            context_id: result.id
          }))
        } else {
          // Standard embedding response format
          const embeddings = response.result?.data || response.data || []
          data = embeddings.map((embedding: number[], index: number) => ({
            embedding,
            index
          }))
        }
        usage = undefined
        id = `embed-bge-m3-${Date.now()}`
      } else {
        // Other Workers AI embedding models
        const embeddings = response.result?.data || response.data || []
        data = embeddings.map((embedding: number[], index: number) => ({
          embedding,
          index
        }))
        usage = undefined
        id = `embed-${Date.now()}`
      }
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
