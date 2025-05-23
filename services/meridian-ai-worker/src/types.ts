
// =============================================================================
// AI Capabilities
// =============================================================================

export type AICapability = 'chat' | 'embedding' | 'image' | 'audio' | 'vision'

// =============================================================================
// Unified Request Types
// =============================================================================

export interface BaseAIRequest {
  model?: string
  provider?: string
  fallback?: boolean
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

export interface ChatRequest extends BaseAIRequest {
  capability: 'chat'
  messages: ChatMessage[]
}

export interface EmbeddingRequest extends BaseAIRequest {
  capability: 'embedding'
  input: string | string[]
  dimensions?: number
}

export interface ImageRequest extends BaseAIRequest {
  capability: 'image'
  prompt: string
  size?: string
  quality?: string
  style?: string
  n?: number
}

export interface AudioRequest extends BaseAIRequest {
  capability: 'audio'
  input: string
  voice?: string
  format?: string
  speed?: number
}

export interface VisionRequest extends BaseAIRequest {
  capability: 'vision'
  messages: VisionMessage[]
}

export type AIRequest = ChatRequest | EmbeddingRequest | ImageRequest | AudioRequest | VisionRequest

// =============================================================================
// Message Types
// =============================================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface VisionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{
    type: 'text' | 'image_url'
    text?: string
    image_url?: { url: string }
  }>
}

// =============================================================================
// Unified Response Types
// =============================================================================

export interface BaseAIResponse {
  id: string
  provider: string
  model: string
  cached?: boolean
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export interface ChatResponse extends BaseAIResponse {
  capability: 'chat'
  choices: Array<{
    message: ChatMessage
    finish_reason: string
  }>
}

export interface EmbeddingResponse extends BaseAIResponse {
  capability: 'embedding'
  data: Array<{
    embedding: number[]
    index: number
  }>
}

export interface ImageResponse extends BaseAIResponse {
  capability: 'image'
  data: Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }>
}

export interface AudioResponse extends BaseAIResponse {
  capability: 'audio'
  data: string // base64 encoded audio
}

export interface VisionResponse extends BaseAIResponse {
  capability: 'vision'
  choices: Array<{
    message: ChatMessage
    finish_reason: string
  }>
}

export type AIResponse = ChatResponse | EmbeddingResponse | ImageResponse | AudioResponse | VisionResponse

// =============================================================================
// Provider Configuration
// =============================================================================

export interface ModelConfig {
  name: string
  capabilities: AICapability[]
  endpoint: string
  max_tokens?: number
  supports_streaming?: boolean
  cost_per_token?: {
    input: number
    output: number
  }
}

export interface ProviderConfig {
  name: string
  base_url: string
  models: ModelConfig[]
  auth_header: string
  default_model?: string
}

// =============================================================================
// AI Gateway Types
// =============================================================================

export interface AIGatewayRequest {
  provider: string
  endpoint: string
  headers: Record<string, string>
  body: any
}

// =============================================================================
// Provider Interface
// =============================================================================

export interface BaseProvider {
  name: string
  config: ProviderConfig
  
  getSupportedCapabilities(): AICapability[]
  getModelsForCapability(capability: AICapability): ModelConfig[]
  getDefaultModel(capability: AICapability): string | undefined
  
  buildRequest(request: AIRequest): AIGatewayRequest
  mapResponse(response: any, originalRequest: AIRequest): AIResponse
}

// =============================================================================
// Capability Handlers
// =============================================================================

export interface CapabilityHandler<TRequest extends AIRequest, TResponse extends AIResponse> {
  capability: AICapability
  buildProviderRequest(request: TRequest, model: ModelConfig): any
  parseProviderResponse(response: any, request: TRequest, model: ModelConfig): TResponse
}

export interface Env {
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_GATEWAY_ID: string
  CLOUDFLARE_API_TOKEN: string
  OPENAI_API_KEY: string
  ANTHROPIC_API_KEY?: string
  GOOGLE_API_KEY?: string
}

// Cloudflare Workers environment with string index signature
export interface CloudflareEnv extends Record<string, string | undefined> {
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_GATEWAY_ID: string
  CLOUDFLARE_API_TOKEN: string
  OPENAI_API_KEY: string
  ANTHROPIC_API_KEY?: string
  GOOGLE_API_KEY?: string
}
