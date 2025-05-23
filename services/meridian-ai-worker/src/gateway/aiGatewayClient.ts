import { Env } from '../types';

export class AIGatewayClient {
  private gatewayUrl: string;
  private gatewayToken: string;
  private apiKeys: Record<string, string>;
  private cloudflareAccountId: string;
  private gatewayId: string;

  constructor(env: Env) {
    this.cloudflareAccountId = env.AI_GATEWAY_ACCOUNT_ID || '';
    this.gatewayId = env.AI_GATEWAY_NAME || '';
    this.gatewayUrl = env.AI_GATEWAY_URL || `https://gateway.ai.cloudflare.com/v1/${this.cloudflareAccountId}/${this.gatewayId}`;
    this.gatewayToken = env.AI_GATEWAY_TOKEN || '';
    
    // 初始化各提供商的API密钥
    this.apiKeys = {
      'openai': env.OPENAI_API_KEY || '',
      'anthropic': env.ANTHROPIC_API_KEY || '',
      'google': env.GOOGLE_API_KEY || '',
      'cloudflare': env.CLOUDFLARE_API_KEY || '' // Cloudflare API Token
    };
    
    if (!this.gatewayUrl) {
      throw new Error('AI Gateway URL 必须配置');
    }
    
    // 验证必要配置
    if (!this.cloudflareAccountId || !this.gatewayId) {
      console.warn('Cloudflare Account ID 或 Gateway ID 未配置，可能影响功能使用');
    }
    
    if (!this.gatewayToken) {
      console.warn('AI Gateway Token 未配置，将无法使用认证网关功能');
    }
  }

  /**
   * 获取指定提供商的API密钥
   */
  private getApiKey(provider: string): string {
    return this.apiKeys[provider.toLowerCase()] || '';
  }

  /**
   * 使用双层认证发送请求
   * 所有提供商统一使用 AI Gateway Token + 提供商 API Key 的认证方式
   */
  async requestWithProviderKey<T = any>(
    provider: string, 
    endpoint: string, 
    payload: any, 
    options: Record<string, any> = {}
  ): Promise<T> {
    // 验证 Gateway Token（双层认证必需）
    if (!this.gatewayToken) {
      throw new Error('AI Gateway Token 未配置，双层认证需要此 Token');
    }
    
    // 统一的提供商映射表
    const providerMap: Record<string, string> = {
      'google': 'google-ai-studio',
      'openai': 'openai',
      'anthropic': 'anthropic',
      'cloudflare': 'workers-ai'
    };
    
    // 构建URL - 统一格式
    const mappedProvider = providerMap[provider.toLowerCase()] || provider;
    const url = `${this.gatewayUrl}/${mappedProvider}/${endpoint}`;
    
    // 获取提供商API密钥
    const apiKey = this.getApiKey(provider);
    if (!apiKey) {
      throw new Error(`${provider} API Key 未配置，双层认证需要提供商 API Key`);
    }
    
    // 设置通用请求头
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // 第一层认证：AI Gateway Token
      'cf-aig-authorization': `Bearer ${this.gatewayToken}`
    };
    
    // 第二层认证：根据提供商设置不同的认证头
    switch (provider.toLowerCase()) {
      case 'cloudflare':
        // Cloudflare Workers AI 使用 Authorization Bearer Token
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
        
      case 'google':
        // Google AI Studio 使用 x-goog-api-key
        headers['x-goog-api-key'] = apiKey;
        break;
        
      case 'anthropic':
        // Anthropic 使用 x-api-key
        headers['x-api-key'] = apiKey;
        break;
        
      case 'openai':
      default:
        // OpenAI 和其他提供商使用 Authorization Bearer Token
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
    }
    
    console.log('发送双层认证 AI Gateway 请求', {
      provider,
      mappedProvider,
      url,
      hasGatewayToken: !!this.gatewayToken,
      hasApiKey: !!apiKey,
      authMethod: 'dual-layer',
      payloadPreview: JSON.stringify(payload).substring(0, 100) + '...'
    });
    
    // 发送请求
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      
      // 检查响应状态
      if (!response.ok) {
        const errorText = await response.text();
        console.error('AI Gateway 双层认证请求失败', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          url,
          provider,
          headers: Object.keys(headers)
        });
        
        throw new Error(`AI Gateway 请求失败: ${response.status} ${response.statusText}\n${errorText}`);
      }
      
      const result = await response.json();
      console.log('AI Gateway 请求成功', {
        provider,
        status: response.status,
        responseType: typeof result
      });
      
      return result as T;
    } catch (error) {
      console.error('AI Gateway 请求异常', {
        provider,
        url,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * 验证认证配置是否完整
   */
  validateConfiguration(provider: string): { valid: boolean; message: string } {
    if (!this.gatewayToken) {
      return {
        valid: false,
        message: 'AI Gateway Token 未配置，双层认证需要此 Token'
      };
    }
    
    const apiKey = this.getApiKey(provider);
    if (!apiKey) {
      return {
        valid: false,
        message: `${provider} API Key 未配置，双层认证需要提供商 API Key`
      };
    }
    
    if (!this.cloudflareAccountId || !this.gatewayId) {
      return {
        valid: false,
        message: 'Cloudflare Account ID 或 Gateway ID 未配置'
      };
    }
    
    return {
      valid: true,
      message: '配置验证通过'
    };
  }

  /**
   * 获取网关信息
   */
  getGatewayInfo(): Record<string, any> {
    return {
      gatewayUrl: this.gatewayUrl,
      accountId: this.cloudflareAccountId,
      gatewayId: this.gatewayId,
      hasGatewayToken: !!this.gatewayToken,
      configuredProviders: Object.keys(this.apiKeys).filter(key => !!this.apiKeys[key])
    };
  }
}
