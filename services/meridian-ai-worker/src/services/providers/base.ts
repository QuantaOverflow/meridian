
import { 
  BaseProvider, 
  ProviderConfig, 
  AICapability,
  AIRequest,
  AIResponse
} from '../../types'
import { getCapabilityHandler } from '../../capabilities'

export abstract class AbstractProvider implements BaseProvider {
  abstract config: ProviderConfig

  getSupportedCapabilities(): AICapability[] {
    const capabilities = new Set<AICapability>()
    this.config.models.forEach(model => {
      model.capabilities.forEach(cap => capabilities.add(cap))
    })
    return Array.from(capabilities)
  }

  mapResponse(response: any, originalRequest: AIRequest): AIResponse {
    const modelName = originalRequest.model
    const model = this.config.models.find(m => m.name === modelName)
    if (!model) {
      throw new Error(`Model not found: ${modelName}`)
    }

    // Get capability handler and parse response
    const handler = getCapabilityHandler(originalRequest.capability)
    return handler.parseProviderResponse(response, model)
  }
}
