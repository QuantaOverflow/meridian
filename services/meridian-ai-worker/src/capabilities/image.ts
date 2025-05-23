
import { 
  ImageRequest, 
  ImageResponse, 
  CapabilityHandler, 
  ModelConfig 
} from '../types'

export class ImageCapabilityHandler implements CapabilityHandler<ImageRequest, ImageResponse> {
  capability = 'image' as const

  buildProviderRequest(request: ImageRequest, model: ModelConfig): any {
    const baseRequest = {
      model: model.name,
      prompt: request.prompt,
      size: request.size ?? "1024x1024",
      quality: request.quality ?? "standard",
      n: request.n ?? 1
    }

    // Provider-specific formatting
    switch (model.name.split('/')[0]) {
      case '@cf': // Workers AI models
        return {
          prompt: request.prompt
        }
      
      default: // OpenAI and compatible
        return baseRequest
    }
  }

  parseProviderResponse(response: any, request: ImageRequest, model: ModelConfig): ImageResponse {
    let data: Array<{ url?: string, b64_json?: string, revised_prompt?: string }>
    let usage: any
    let id: string

    if (model.name.startsWith('@cf')) {
      // Workers AI format - returns base64 image data
      const imageData = response.result?.image || response.image
      data = [{
        b64_json: imageData
      }]
      usage = undefined
      id = `img-${Date.now()}`
    } else {
      // OpenAI format (default)
      data = response.data || []
      usage = response.usage
      id = response.id || `img-${Date.now()}`
    }

    return {
      capability: 'image',
      id,
      provider: model.name.split('/')[0] === '@cf' ? 'workers-ai' : 'openai',
      model: model.name,
      data,
      usage,
      cached: response.cached
    }
  }
}
