import { ChatCapabilityHandler } from './chat'
import { AICapability, CapabilityHandler, AIRequest, AIResponse } from '../types'

// 只剩 chat：其余 capability（embedding / image / video / 语音）从无调用方，已删。
const CAPABILITY_HANDLERS: Partial<Record<AICapability, CapabilityHandler<any, any>>> = {
  chat: new ChatCapabilityHandler(),
}

export function getCapabilityHandler(capability: AICapability): CapabilityHandler<AIRequest, AIResponse> {
  const handler = CAPABILITY_HANDLERS[capability]
  if (!handler) {
    throw new Error(`Unsupported capability: ${capability}`)
  }
  return handler
}
