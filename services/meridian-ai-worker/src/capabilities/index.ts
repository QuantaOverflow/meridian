
export { ChatCapabilityHandler } from './chat'
export { EmbeddingCapabilityHandler } from './embedding'
export { ImageCapabilityHandler } from './image'

import { ChatCapabilityHandler } from './chat'
import { EmbeddingCapabilityHandler } from './embedding'
import { ImageCapabilityHandler } from './image'
import { AICapability, CapabilityHandler, AIRequest, AIResponse } from '../types'

// Registry of all capability handlers
export const CAPABILITY_HANDLERS: Record<AICapability, CapabilityHandler<any, any>> = {
  chat: new ChatCapabilityHandler(),
  embedding: new EmbeddingCapabilityHandler(),
  image: new ImageCapabilityHandler(),
  audio: new ChatCapabilityHandler(), // Placeholder - implement AudioCapabilityHandler
  vision: new ChatCapabilityHandler(), // Placeholder - implement VisionCapabilityHandler
}

export function getCapabilityHandler(capability: AICapability): CapabilityHandler<AIRequest, AIResponse> {
  const handler = CAPABILITY_HANDLERS[capability]
  if (!handler) {
    throw new Error(`Unsupported capability: ${capability}`)
  }
  return handler
}
