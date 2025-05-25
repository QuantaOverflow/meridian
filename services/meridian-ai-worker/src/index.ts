import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AIGatewayService } from './services/ai-gateway'
import { 
  AIRequest, 
  ChatRequest, 
  EmbeddingRequest, 
  ImageRequest,
  CloudflareEnv,
  AICapability 
} from './types'

type HonoEnv = {
  Bindings: CloudflareEnv
}

const app = new Hono<HonoEnv>()

// CORS middleware
app.use('*', cors({
  origin: ['*'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-API-Key', 
    'X-Client-ID', 
    'X-User-ID',
    'X-Request-Signature',
    'X-Tag-*',
    'X-Trace-ID'
  ],
}))

// Health check with AI Gateway status
app.get('/health', async (c) => {
  try {
    const env = c.env
    if (!env) {
      return c.json({ 
        status: 'error',
        error: 'Environment not configured' 
      }, 500)
    }

    const aiGatewayService = new AIGatewayService(env)
    
    // Check AI Gateway enhanced features status
    const enhancedStatus = {
      authentication: !!env.AI_GATEWAY_AUTH_TOKEN,
      cost_tracking: env.AI_GATEWAY_ENABLE_COST_TRACKING === 'true',
      caching: env.AI_GATEWAY_ENABLE_CACHING === 'true',
      metrics: env.AI_GATEWAY_ENABLE_METRICS === 'true',
      logging: env.AI_GATEWAY_ENABLE_LOGGING === 'true',
      default_cache_ttl: parseInt(env.AI_GATEWAY_DEFAULT_CACHE_TTL || '3600')
    }

    return c.json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      service: 'meridian-ai-worker',
      version: '2.0.0',
      ai_gateway: enhancedStatus,
      environment: env.ENVIRONMENT || 'unknown'
    })
  } catch (error) {
    return c.json({ 
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// AI Gateway configuration validation
app.get('/ai-gateway/config', async (c) => {
  try {
    const env = c.env
    if (!env) {
      return c.json({ error: 'Environment not configured' }, 500)
    }

    const aiGatewayService = new AIGatewayService(env)
    
    // Validate basic configuration
    const basicConfig = {
      account_id: !!env.CLOUDFLARE_ACCOUNT_ID,
      gateway_id: !!env.CLOUDFLARE_GATEWAY_ID,
      api_token: !!env.CLOUDFLARE_API_TOKEN
    }

    // Enhanced features configuration
    const enhancedConfig = {
      authentication: {
        enabled: !!env.AI_GATEWAY_TOKEN,
        token_configured: !!env.AI_GATEWAY_TOKEN
      },
      cost_tracking: {
        enabled: env.ENABLE_COST_TRACKING === 'true',
        global_setting: env.ENABLE_COST_TRACKING
      },
      caching: {
        enabled: env.ENABLE_AI_GATEWAY_CACHING === 'true',
        default_ttl: env.DEFAULT_CACHE_TTL || '3600'
      },
      metrics: {
        enabled: env.ENABLE_AI_GATEWAY_METRICS === 'true',
        logging_enabled: env.ENABLE_AI_GATEWAY_LOGGING === 'true',
        log_level: env.AI_GATEWAY_LOG_LEVEL || 'info'
      },
      features: {
        smart_caching: true,
        auto_fallback: true,
        request_metadata: true,
        performance_tracking: true
      }
    }

    // Provider configurations
    const providers = aiGatewayService.getAvailableProviders()
    const providerConfigs = providers.map((name: string) => {
      const models = aiGatewayService.getModelConfigsForProvider(name)
      return {
        name,
        models_count: models.length,
        has_ai_gateway_config: models.some(model => !!model.ai_gateway_config),
        sample_model_config: models[0]?.ai_gateway_config || null
      }
    })

    const configStatus = {
      basic: basicConfig,
      enhanced: enhancedConfig,
      providers: providerConfigs,
      validation: {
        basic_complete: Object.values(basicConfig).every(Boolean),
        has_enhanced_features: Object.values(enhancedConfig).some(config => 
          typeof config === 'object' ? Object.values(config).some(Boolean) : Boolean(config)
        ),
        providers_available: providers.length > 0
      }
    }

    return c.json(configStatus)
  } catch (error) {
    console.error('AI Gateway config validation error:', error)
    return c.json({ 
      error: 'Failed to validate AI Gateway configuration',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Get available providers and their capabilities
app.get('/providers', (c) => {
  try {
    const env = c.env
    if (!env) {
      return c.json({ error: 'Environment not configured' }, 500)
    }

    const aiGateway = new AIGatewayService(env)
    const providers = aiGateway.getAvailableProviders()
    
    const providerInfo = providers.map((name: string) => ({
      name,
      capabilities: aiGateway.getProviderCapabilities(name),
      models: aiGateway.getModelsForProvider(name)
    }))
    
    return c.json({ 
      providers: providerInfo,
      total: providers.length
    })
  } catch (error) {
    console.error('Providers error:', error)
    return c.json({ error: 'Failed to get providers' }, 500)
  }
})

// Get providers for specific capability
app.get('/capabilities/:capability/providers', (c) => {
  try {
    const capability = c.req.param('capability') as AICapability
    const env = c.env
    if (!env) {
      return c.json({ error: 'Environment not configured' }, 500)
    }

    const aiGateway = new AIGatewayService(env)
    const providers = aiGateway.getProvidersForCapability(capability)
    
    return c.json({ 
      capability,
      providers,
      count: providers.length
    })
  } catch (error) {
    console.error('Capability providers error:', error)
    return c.json({ error: 'Failed to get capability providers' }, 500)
  }
})

// Unified AI endpoint - handles all capabilities with enhanced security
app.post('/ai', async (c) => {
  try {
    const env = c.env
    if (!env) {
      return c.json({ error: 'Environment variables not configured' }, 500)
    }

    const aiGateway = new AIGatewayService(env)
    
    // Use enhanced authentication and processing
    const request = c.req.raw
    const response = await aiGateway.processRequestWithAuth(request)
    
    // Return the response directly since it's already a Response object
    return response
  } catch (error) {
    console.error('AI request error:', error)
    return c.json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Chat endpoint (backward compatibility)
app.post('/chat', async (c) => {
  try {
    const body = await c.req.json()
    
    // Validate request
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'Messages array is required and cannot be empty' }, 400)
    }

    const env = c.env
    if (!env) {
      return c.json({ error: 'Environment variables not configured' }, 500)
    }

    // Convert to new format
    const chatRequest: ChatRequest = {
      capability: 'chat',
      messages: body.messages,
      model: body.model,
      provider: body.provider,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      stream: body.stream,
      fallback: body.fallback
    }

    const aiGateway = new AIGatewayService(env)
    const response = await aiGateway.processRequest(chatRequest)
    return c.json(response)
  } catch (error) {
    console.error('Chat error:', error)
    return c.json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Embedding endpoint
app.post('/embed', async (c) => {
  try {
    const body = await c.req.json()
    
    // Validate request
    if (!body.input) {
      return c.json({ error: 'Input is required' }, 400)
    }

    const env = c.env
    if (!env) {
      return c.json({ error: 'Environment variables not configured' }, 500)
    }

    const embeddingRequest: EmbeddingRequest = {
      capability: 'embedding',
      input: body.input,
      model: body.model,
      provider: body.provider,
      dimensions: body.dimensions,
      fallback: body.fallback
    }

    const aiGateway = new AIGatewayService(env)
    const response = await aiGateway.processRequest(embeddingRequest)
    return c.json(response)
  } catch (error) {
    console.error('Embedding error:', error)
    return c.json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Image generation endpoint
app.post('/images/generate', async (c) => {
  try {
    const body = await c.req.json()
    
    // Validate request
    if (!body.prompt) {
      return c.json({ error: 'Prompt is required' }, 400)
    }

    const env = c.env
    if (!env) {
      return c.json({ error: 'Environment variables not configured' }, 500)
    }

    const imageRequest: ImageRequest = {
      capability: 'image',
      prompt: body.prompt,
      model: body.model,
      provider: body.provider,
      size: body.size,
      quality: body.quality,
      style: body.style,
      n: body.n,
      fallback: body.fallback
    }

    const aiGateway = new AIGatewayService(env)
    const response = await aiGateway.processRequest(imageRequest)
    return c.json(response)
  } catch (error) {
    console.error('Image generation error:', error)
    return c.json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Streaming endpoints (future implementation)
app.post('/chat/stream', async (c) => {
  return c.json({ error: 'Streaming not yet implemented' }, 501)
})

app.post('/ai/stream', async (c) => {
  return c.json({ error: 'Streaming not yet implemented' }, 501)
})

export default app
