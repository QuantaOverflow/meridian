
import { 
  BaseProvider, 
  ProviderConfig, 
  ModelConfig, 
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

  getModelsForCapability(capability: AICapability): ModelConfig[] {
    return this.config.models.filter(model => 
      model.capabilities.includes(capability)
    )
  }

  getDefaultModel(capability: AICapability): string | undefined {
    // First try provider's default model if it supports the capability
    const defaultModel = this.config.models.find(m => 
      m.name === this.config.default_model && 
      m.capabilities.includes(capability)
    )
    
    if (defaultModel) {
      return defaultModel.name
    }

    // Otherwise return first model that supports the capability
    const firstModel = this.getModelsForCapability(capability)[0]
    return firstModel?.name
  }

  mapResponse(response: any, originalRequest: AIRequest): AIResponse {
    const modelName = originalRequest.model || this.getDefaultModel(originalRequest.capability)
    if (!modelName) {
      throw new Error(`No model available for capability: ${originalRequest.capability}`)
    }

    const model = this.config.models.find(m => m.name === modelName)
    if (!model) {
      throw new Error(`Model not found: ${modelName}`)
    }

    // Get capability handler and parse response
    const handler = getCapabilityHandler(originalRequest.capability)
    return handler.parseProviderResponse(response, model)
  }
}
