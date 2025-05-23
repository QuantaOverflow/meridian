
import { 
  BaseProvider, 
  ProviderConfig, 
  ModelConfig, 
  AICapability,
  AIRequest,
  AIResponse,
  AIGatewayRequest
} from '../../types'
import { getCapabilityHandler } from '../../capabilities'

export abstract class AbstractProvider implements BaseProvider {
  abstract name: string
  abstract config: ProviderConfig
  
  constructor(protected apiKey?: string) {}

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

  buildRequest(request: AIRequest): AIGatewayRequest {
    // Get the appropriate model
    const modelName = request.model || this.getDefaultModel(request.capability)
    if (!modelName) {
      throw new Error(`No model available for capability: ${request.capability}`)
    }

    const model = this.config.models.find(m => m.name === modelName)
    if (!model) {
      throw new Error(`Model not found: ${modelName}`)
    }

    if (!model.capabilities.includes(request.capability)) {
      throw new Error(`Model ${modelName} does not support capability: ${request.capability}`)
    }

    // Get capability handler and build request
    const handler = getCapabilityHandler(request.capability)
    const providerRequestBody = handler.buildProviderRequest(request, model)

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.apiKey) {
      if (this.config.auth_header === 'Authorization') {
        headers['Authorization'] = `Bearer ${this.apiKey}`
      } else {
        headers[this.config.auth_header] = this.apiKey
      }
    }

    // Add provider-specific headers
    this.addProviderHeaders(headers, request, model)

    // Build endpoint URL
    const endpoint = this.buildEndpointUrl(model, request)

    return {
      provider: this.name,
      endpoint,
      headers,
      body: providerRequestBody
    }
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
    return handler.parseProviderResponse(response, originalRequest, model)
  }

  protected abstract addProviderHeaders(
    headers: Record<string, string>, 
    request: AIRequest, 
    model: ModelConfig
  ): void

  protected abstract buildEndpointUrl(model: ModelConfig, request: AIRequest): string
}
