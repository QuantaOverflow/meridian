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

// Health check
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'meridian-ai-worker',
    version: '2.0.0'
  })
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
