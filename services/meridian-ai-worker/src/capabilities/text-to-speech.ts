import { CapabilityHandler, TextToSpeechRequest, TextToSpeechResponse, ModelConfig } from '../types'

export class TextToSpeechCapability implements CapabilityHandler<TextToSpeechRequest, TextToSpeechResponse> {
  capability: 'text-to-speech' = 'text-to-speech'

  buildProviderRequest(request: TextToSpeechRequest, model: ModelConfig): any {
    const baseRequest = {
      input: request.input,
      model: model.name
    }

    // Gemini 2.5 specific parameters
    if (model.name.includes('gemini-2.5')) {
      return {
        ...baseRequest,
        voice: request.voice || 'default',
        language: request.language || 'en-US',
        format: request.format || 'mp3',
        speed: request.speed || 1.0,
        pitch: request.pitch || 0
      }
    }

    return baseRequest
  }

  parseProviderResponse(response: any, request: TextToSpeechRequest, model: ModelConfig): TextToSpeechResponse {
    return {
      id: response.id || `tts_${Date.now()}`,
      capability: 'text-to-speech',
      provider: 'google-ai-studio',
      model: model.name,
      cached: response.cached || false,
      data: response.audio_content || response.data,
      format: request.format || 'mp3',
      duration: response.duration,
      usage: response.usage,
      processingTime: response.processingTime
    }
  }
} 