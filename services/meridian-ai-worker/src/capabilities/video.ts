import { CapabilityHandler, VideoRequest, VideoResponse, ModelConfig } from '../types'

export class VideoCapability implements CapabilityHandler<VideoRequest, VideoResponse> {
  capability: 'video' = 'video'

  buildProviderRequest(request: VideoRequest, model: ModelConfig): any {
    const baseRequest = {
      prompt: request.prompt,
      model: model.name
    }

    // Veo 2.0 specific parameters
    if (model.name === 'veo-2.0-generate-001') {
      return {
        ...baseRequest,
        duration: request.duration || 5, // 默认5秒
        resolution: request.resolution || '720p',
        fps: request.fps || 24,
        style: request.style || 'realistic',
        ...(request.image_input && { image_input: request.image_input })
      }
    }

    return baseRequest
  }

  parseProviderResponse(response: any, request: VideoRequest, model: ModelConfig): VideoResponse {
    // Handle different provider response formats
    let videoData = []

    if (model.name === 'veo-2.0-generate-001') {
      // Veo 2.0 response format
      videoData = response.data?.map((item: any) => ({
        url: item.url,
        b64_video: item.b64_video,
        duration: item.duration,
        resolution: item.resolution,
        fps: item.fps
      })) || []
    } else {
      // Generic video response format
      videoData = response.data || []
    }

    return {
      id: response.id || `video_${Date.now()}`,
      capability: 'video',
      provider: model.name.includes('veo') ? 'google-ai-studio' : 'unknown',
      model: model.name,
      cached: response.cached || false,
      data: videoData,
      usage: response.usage,
      processingTime: response.processingTime
    }
  }
} 