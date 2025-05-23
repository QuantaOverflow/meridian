
import { 
  AIRequest, 
  AIResponse, 
  AIGatewayRequest, 
  CloudflareEnv, 
  BaseProvider,
  AICapability,
  ChatRequest,
  EmbeddingRequest,
  ImageRequest
} from '../types'
import { OpenAIProvider } from './providers/openai'
import { WorkersAIProvider } from './providers/workers-ai'
import { AnthropicProvider } from './providers/anthropic'
import { getProvidersForCapability, getAllProviders } from '../config/providers'

export class AIGatewayService {
  private gatewayUrl: string
  private providers: Map<string, BaseProvider>

  constructor(private env: CloudflareEnv) {
    this.gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_GATEWAY_ID}`
    
    // Initialize providers
    this.providers = new Map<string, BaseProvider>()
    
    if (env.OPENAI_API_KEY) {
      this.providers.set('openai', new OpenAIProvider(env.OPENAI_API_KEY))
    }
    
    if (env.CLOUDFLARE_API_TOKEN) {
      this.providers.set('workers-ai', new WorkersAIProvider(env.CLOUDFLARE_API_TOKEN, env))
    }
    
    if (env.ANTHROPIC_API_KEY) {
      this.providers.set('anthropic', new AnthropicProvider(env.ANTHROPIC_API_KEY))
    }
  }

  async processRequest(request: AIRequest): Promise<AIResponse> {
    // Determine provider to use
    const providerName = this.selectProvider(request)
    const provider = this.providers.get(providerName)
    
    if (!provider) {
      throw new Error(`Provider not available: ${providerName}`)
    }

    // Validate provider supports the capability
    if (!provider.getSupportedCapabilities().includes(request.capability)) {
      throw new Error(`Provider ${providerName} does not support capability: ${request.capability}`)
    }

    // Build the AI Gateway request
    const aiGatewayRequest = provider.buildRequest(request)
    
    // Execute the request
    let response: any
    try {
      response = await this.executeRequest(aiGatewayRequest)
    } catch (error) {
      // Try fallback if enabled
      if (request.fallback) {
        const fallbackProvider = this.selectFallbackProvider(request, providerName)
        if (fallbackProvider) {
          const fallbackRequest = fallbackProvider.buildRequest(request)
          response = await this.executeRequest(fallbackRequest)
        } else {
          throw error
        }
      } else {
        throw error
      }
    }

    // Map response back to standard format
    return provider.mapResponse(response, request)
  }

  private selectProvider(request: AIRequest): string {
    // If provider is explicitly specified
    if (request.provider && this.providers.has(request.provider)) {
      const provider = this.providers.get(request.provider)!
      if (provider.getSupportedCapabilities().includes(request.capability)) {
        return request.provider
      }
    }

    // Find providers that support this capability
    const supportedProviders = getProvidersForCapability(request.capability)
      .filter(name => this.providers.has(name))

    if (supportedProviders.length === 0) {
      throw new Error(`No available providers support capability: ${request.capability}`)
    }

    // Return first available provider
    return supportedProviders[0]
  }

  private selectFallbackProvider(request: AIRequest, excludeProvider: string): BaseProvider | null {
    const supportedProviders = getProvidersForCapability(request.capability)
      .filter(name => name !== excludeProvider && this.providers.has(name))

    if (supportedProviders.length === 0) {
      return null
    }

    return this.providers.get(supportedProviders[0]) || null
  }

  private async executeRequest(aiGatewayRequest: AIGatewayRequest): Promise<any> {
    const response = await fetch(aiGatewayRequest.endpoint, {
      method: 'POST',
      headers: {
        ...aiGatewayRequest.headers,
        'cf-aig-cache-ttl': '3600', // Cache for 1 hour
      },
      body: JSON.stringify(aiGatewayRequest.body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`)
    }

    return await response.json()
  }

  // Convenience methods for different capabilities
  async chat(request: Omit<ChatRequest, 'capability'>): Promise<AIResponse> {
    return this.processRequest({ ...request, capability: 'chat' })
  }

  async embed(request: Omit<EmbeddingRequest, 'capability'>): Promise<AIResponse> {
    return this.processRequest({ ...request, capability: 'embedding' })
  }

  async generateImage(request: Omit<ImageRequest, 'capability'>): Promise<AIResponse> {
    return this.processRequest({ ...request, capability: 'image' })
  }

  // Provider management methods
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys())
  }

  getProvidersForCapability(capability: AICapability): string[] {
    return Array.from(this.providers.entries())
      .filter(([_, provider]) => provider.getSupportedCapabilities().includes(capability))
      .map(([name, _]) => name)
  }

  getProviderCapabilities(providerName: string): AICapability[] {
    const provider = this.providers.get(providerName)
    return provider ? provider.getSupportedCapabilities() : []
  }

  getModelsForProvider(providerName: string): string[] {
    const provider = this.providers.get(providerName)
    if (!provider) return []
    
    return provider.config.models.map(model => model.name)
  }
}
