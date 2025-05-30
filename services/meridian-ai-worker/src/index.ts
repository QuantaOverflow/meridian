import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AIGatewayService } from './services/ai-gateway'
import { getArticleAnalysisPrompt, articleAnalysisSchema, ArticleAnalysisResult } from './prompts/articleAnalysis'
import { 
  AIRequest, 
  ChatRequest, 
  EmbeddingRequest, 
  ImageRequest,
  CloudflareEnv,
  AICapability,
  ChatResponse,
  EmbeddingResponse
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

// =============================================================================
// 🎯 Direct Binding Interface for Service-to-Service Communication
// =============================================================================

/**
 * AI Worker Service Class for direct binding calls
 * This class provides typed interfaces for other Workers to call this service
 */
class MeridianAIWorkerService {
  private aiGateway: AIGatewayService

  constructor(private env: CloudflareEnv) {
    this.aiGateway = new AIGatewayService(env)
  }

  /**
   * Analyze article content - Direct binding method
   * Uses the same prompt and schema as the backend for consistency
   */
  async analyzeArticle(params: {
    title: string
    content: string
    options?: {
      provider?: string
      model?: string
    }
  }): Promise<{
    success: boolean
    data?: ArticleAnalysisResult | string
    error?: string
    metadata?: any
  }> {
    try {
      const { title, content, options = {} } = params

      if (!title || !content) {
        return {
          success: false,
          error: 'Missing required fields: title and content are required'
        }
      }

      // Generate the specialized article analysis prompt
      const analysisPrompt = getArticleAnalysisPrompt(title, content)

      const analysisRequest: ChatRequest = {
        capability: 'chat',
        provider: options.provider || 'google-ai-studio',
        model: options.model || 'gemini-1.5-flash-8b-001',
        messages: [
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        temperature: 0, // Consistent results for structured extraction
        metadata: {
          requestId: crypto.randomUUID(),
          timestamp: Date.now(),
          source: {
            origin: 'meridian-ai-worker'
          },
          customTags: {
            endpoint: 'analyze-article'
          }
        }
      }

      const response = await this.aiGateway.processRequest(analysisRequest)
      const chatResponse = response as ChatResponse
      const rawAnalysisData = chatResponse.choices?.[0]?.message?.content

      if (!rawAnalysisData) {
        return {
          success: false,
          error: 'No analysis data received from AI provider'
        }
      }

      // Try to parse and validate the JSON response
      try {
        // Extract JSON from the response (in case there's extra text)
        let jsonStr = rawAnalysisData.trim()
        
        // Remove markdown code blocks
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1].trim()
        }
        
        // If still no valid JSON start, try to find the JSON object
        if (!jsonStr.startsWith('{')) {
          const jsonMatch = jsonStr.match(/{\s*[\s\S]*\s*}/)
          if (jsonMatch) {
            jsonStr = jsonMatch[0]
          }
        }
        
        // Parse the JSON
        const parsedData = JSON.parse(jsonStr)
        
        // Clean and normalize data to match schema
        const normalizedData = {
          language: String(parsedData.language || 'en').substring(0, 2).toLowerCase(),
          primary_location: String(parsedData.primary_location || 'N/A'),
          completeness: parsedData.completeness === 'COMPLETE' || parsedData.completeness === 'PARTIAL_USEFUL' || parsedData.completeness === 'PARTIAL_USELESS' 
            ? parsedData.completeness 
            : (Number(parsedData.completeness) >= 4 ? 'COMPLETE' : Number(parsedData.completeness) >= 2 ? 'PARTIAL_USEFUL' : 'PARTIAL_USELESS'),
          content_quality: parsedData.content_quality === 'OK' || parsedData.content_quality === 'LOW_QUALITY' || parsedData.content_quality === 'JUNK'
            ? parsedData.content_quality
            : (Number(parsedData.content_quality) >= 4 ? 'OK' : Number(parsedData.content_quality) >= 2 ? 'LOW_QUALITY' : 'JUNK'),
          event_summary_points: Array.isArray(parsedData.event_summary_points) ? parsedData.event_summary_points : [],
          thematic_keywords: Array.isArray(parsedData.thematic_keywords) ? parsedData.thematic_keywords : [],
          topic_tags: Array.isArray(parsedData.topic_tags) ? parsedData.topic_tags : [],
          key_entities: Array.isArray(parsedData.key_entities) ? parsedData.key_entities : [],
          content_focus: Array.isArray(parsedData.content_focus) ? parsedData.content_focus : []
        }
        
        // Validate against schema
        const validatedData = articleAnalysisSchema.parse(normalizedData)
        
        return {
          success: true,
          data: validatedData,
          metadata: {
            provider: response.provider,
            model: response.model,
            processingTime: response.processingTime,
            requestId: response.metadata?.requestId,
            validated: true
          }
        }

      } catch (parseError) {
        console.warn('Failed to parse/validate analysis result, returning raw data:', parseError)
        
        // If parsing fails, return the raw string for debugging
        return {
          success: true,
          data: rawAnalysisData,
          metadata: {
            provider: response.provider,
            model: response.model,
            processingTime: response.processingTime,
            requestId: response.metadata?.requestId,
            validated: false,
            parseError: parseError instanceof Error ? parseError.message : 'Unknown parse error'
          }
        }
      }

    } catch (error) {
      console.error('Article analysis error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Generate embeddings - Direct binding method
   */
  async generateEmbedding(params: {
    text: string
    options?: {
      provider?: string
      model?: string
    }
  }): Promise<{
    success: boolean
    data?: number[]
    error?: string
    metadata?: any
  }> {
    try {
      const { text, options = {} } = params

      if (!text) {
        return {
          success: false,
          error: 'Missing required field: text is required'
        }
      }

      const embeddingRequest: EmbeddingRequest = {
        capability: 'embedding',
        provider: options.provider || 'workers-ai',
        model: options.model || '@cf/baai/bge-small-en-v1.5',
        input: text,
        metadata: {
          requestId: crypto.randomUUID(),
          timestamp: Date.now(),
          source: {
            origin: 'meridian-ai-worker'
          },
          customTags: {
            endpoint: 'generate-embedding'
          }
        }
      }

      const response = await this.aiGateway.processRequest(embeddingRequest)
      const embeddingResponse = response as EmbeddingResponse

      return {
        success: true,
        data: embeddingResponse.data[0]?.embedding,
        metadata: {
          provider: response.provider,
          model: response.model,
          processingTime: response.processingTime,
          requestId: response.metadata?.requestId
        }
      }

    } catch (error) {
      console.error('Embedding generation error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Health check - Direct binding method
   */
  async healthCheck(): Promise<{
    status: string
    service: string
    version: string
    providers?: any
  }> {
    try {
      const providers = Array.from(this.aiGateway.getAvailableProviders())
      
      return {
        status: 'healthy',
        service: 'meridian-ai-worker',
        version: '2.0.0',
        providers: {
          available: providers,
          google_configured: !!this.env.GOOGLE_AI_API_KEY,
          workers_ai_configured: !!this.env.CLOUDFLARE_API_TOKEN,
          openai_configured: !!this.env.OPENAI_API_KEY
        }
      }
    } catch (error) {
      return {
        status: 'error',
        service: 'meridian-ai-worker',
        version: '2.0.0'
      }
    }
  }
}

// =============================================================================
// 🌐 HTTP API Endpoints (for external access if needed)
// =============================================================================

// Meridian-specific article analysis endpoint
app.post('/meridian/article/analyze', async (c) => {
  try {
    const body = await c.req.json()
    const service = new MeridianAIWorkerService(c.env)
    const result = await service.analyzeArticle(body)
    
    if (result.success) {
      return c.json(result)
    } else {
      return c.json(result, 400)
    }
  } catch (error) {
    console.error('Article analysis error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to analyze article',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Meridian-specific embedding generation endpoint
app.post('/meridian/embeddings/generate', async (c) => {
  try {
    const body = await c.req.json()
    const service = new MeridianAIWorkerService(c.env)
    const result = await service.generateEmbedding(body)
    
    if (result.success) {
      return c.json(result)
    } else {
      return c.json(result, 400)
    }
  } catch (error) {
    console.error('Embedding generation error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to generate embeddings',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Meridian configuration endpoint
app.get('/meridian/config', async (c) => {
  try {
    const service = new MeridianAIWorkerService(c.env)
    const healthData = await service.healthCheck()
    
    return c.json({
      ...healthData,
      endpoints: {
        article_analysis: '/meridian/article/analyze',
        embedding_generation: '/meridian/embeddings/generate',
        health_check: '/health'
      },
      features: {
        retry_logic: true,
        cost_tracking: c.env.AI_GATEWAY_ENABLE_COST_TRACKING === 'true',
        caching: c.env.AI_GATEWAY_ENABLE_CACHING === 'true',
        metrics: c.env.AI_GATEWAY_ENABLE_METRICS === 'true'
      }
    })
  } catch (error) {
    console.error('Config error:', error)
    return c.json({ 
      error: 'Failed to get configuration',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Health check with AI Gateway status
app.get('/health', async (c) => {
  try {
    const service = new MeridianAIWorkerService(c.env)
    const result = await service.healthCheck()
    return c.json(result)
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
      providers: providers.map(name => ({
        name,
        models: aiGateway.getModelsForProvider(name).filter(model => 
          aiGateway.getProviderCapabilities(name).includes(capability)
        )
      })),
      total: providers.length
    })
  } catch (error) {
    console.error('Capability providers error:', error)
    return c.json({ error: 'Failed to get providers for capability' }, 500)
  }
})

// Generic AI request endpoint (supports all capabilities)
app.post('/ai/*', async (c) => {
  try {
    const env = c.env
    if (!env) {
      return c.json({ error: 'Environment not configured' }, 500)
    }

    const aiGateway = new AIGatewayService(env)
    return await aiGateway.processRequestWithAuth(c.req.raw)
  } catch (error) {
    console.error('AI request error:', error)
    return c.json({ 
      error: 'Failed to process AI request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// =============================================================================
// 🎯 Export for Worker Bindings
// =============================================================================

export default app

// Export the service class for direct binding access
export { MeridianAIWorkerService }
