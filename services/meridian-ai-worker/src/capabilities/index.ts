export { ChatCapabilityHandler } from './chat'
export { EmbeddingCapabilityHandler } from './embedding'
export { ImageCapabilityHandler } from './image'
export { VideoCapability } from './video'
export { TextToSpeechCapability } from './text-to-speech'
export { LiveAudioCapability } from './live-audio'

import { ChatCapabilityHandler } from './chat'
import { EmbeddingCapabilityHandler } from './embedding'
import { ImageCapabilityHandler } from './image'
import { VideoCapability } from './video'
import { TextToSpeechCapability } from './text-to-speech'
import { LiveAudioCapability } from './live-audio'
import { AICapability, CapabilityHandler, AIRequest, AIResponse } from '../types'

// Registry of all capability handlers
export const CAPABILITY_HANDLERS: Record<AICapability, CapabilityHandler<any, any>> = {
  chat: new ChatCapabilityHandler(),
  embedding: new EmbeddingCapabilityHandler(),
  image: new ImageCapabilityHandler(),
  video: new VideoCapability(),
  'text-to-speech': new TextToSpeechCapability(),
  'live-audio': new LiveAudioCapability(),
  audio: new ChatCapabilityHandler(), // 保持向后兼容
  vision: new ChatCapabilityHandler(), // 可以使用现有的 chat handler 处理视觉
  'speech-to-text': new ChatCapabilityHandler(), // 可以复用或创建专门的处理器
  'live-video': new LiveAudioCapability(), // 可以复用实时音频处理器逻辑
}

export function getCapabilityHandler(capability: AICapability): CapabilityHandler<AIRequest, AIResponse> {
  const handler = CAPABILITY_HANDLERS[capability]
  if (!handler) {
    throw new Error(`Unsupported capability: ${capability}`)
  }
  return handler
}
