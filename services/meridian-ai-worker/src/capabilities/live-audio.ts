import { CapabilityHandler, LiveAudioRequest, LiveAudioResponse, ModelConfig } from '../types'

export class LiveAudioCapability implements CapabilityHandler<LiveAudioRequest, LiveAudioResponse> {
  capability: 'live-audio' = 'live-audio'

  buildProviderRequest(request: LiveAudioRequest, model: ModelConfig): any {
    const baseRequest = {
      audio_stream: request.audio_stream,
      model: model.name,
      session_id: request.session_id || `session_${Date.now()}`
    }

    // Gemini 2.0 Flash Live specific parameters
    if (model.name === 'gemini-2.0-flash-live') {
      return {
        ...baseRequest,
        config: {
          sample_rate: request.config?.sample_rate || 16000,
          encoding: request.config?.encoding || 'LINEAR16',
          language: request.config?.language || 'en-US',
          enable_automatic_punctuation: true,
          enable_word_time_offsets: true
        }
      }
    }

    return baseRequest
  }

  parseProviderResponse(response: any, request: LiveAudioRequest, model: ModelConfig): LiveAudioResponse {
    return {
      id: response.id || `live_audio_${Date.now()}`,
      capability: 'live-audio',
      provider: 'google-ai-studio',
      model: model.name,
      cached: false, // Live interactions are never cached
      session_id: request.session_id || response.session_id,
      response_audio: response.audio_content,
      text_response: response.text,
      status: response.status || 'completed',
      usage: response.usage,
      processingTime: response.processingTime
    }
  }
} 