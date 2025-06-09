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

// 创建共享的处理器实例以减少重复
const SHARED_CHAT_HANDLER = new ChatCapabilityHandler()
const SHARED_LIVE_AUDIO_HANDLER = new LiveAudioCapability()

// Registry of all capability handlers
export const CAPABILITY_HANDLERS: Record<AICapability, CapabilityHandler<any, any>> = {
  chat: SHARED_CHAT_HANDLER,
  embedding: new EmbeddingCapabilityHandler(),
  image: new ImageCapabilityHandler(),
  video: new VideoCapability(),
  'text-to-speech': new TextToSpeechCapability(),
  'live-audio': SHARED_LIVE_AUDIO_HANDLER,
  
  // 使用共享处理器实例，减少重复创建
  audio: SHARED_CHAT_HANDLER, // 音频处理复用chat逻辑
  vision: SHARED_CHAT_HANDLER, // 视觉处理复用chat逻辑  
  'speech-to-text': SHARED_CHAT_HANDLER, // 语音转文本复用chat逻辑
  'live-video': SHARED_LIVE_AUDIO_HANDLER, // 实时视频复用实时音频逻辑
}

export function getCapabilityHandler(capability: AICapability): CapabilityHandler<AIRequest, AIResponse> {
  const handler = CAPABILITY_HANDLERS[capability]
  if (!handler) {
    throw new Error(`Unsupported capability: ${capability}`)
  }
  return handler
}
