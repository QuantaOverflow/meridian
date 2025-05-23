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
      'cloudflare': env.CLOUDFLARE_API_KEY || '' // 这应该是Cloudflare API Token
    };
    
    if (!this.gatewayUrl) {
      throw new Error('AI Gateway URL 必须配置');
    }
    
    // 验证Cloudflare特定配置
    if (!this.cloudflareAccountId || !this.gatewayId) {
      console.warn('Cloudflare Account ID 或 Gateway ID 未配置，Cloudflare Workers AI功能可能不可用');
    }
  }

  /**
   * 获取指定提供商的API密钥
   */
  private getApiKey(provider: string): string {
    return this.apiKeys[provider.toLowerCase()] || '';
  }

  /**
   * 使用提供商API密钥发送请求
   * 此方法同时使用Gateway Token和提供商自己的API密钥
   */
  async requestWithProviderKey<T = any>(
    provider: string, 
    endpoint: string, 
    payload: any, 
    options: Record<string, any> = {}
  ): Promise<T> {
    // 验证Gateway Token
    if (!this.gatewayToken) {
      throw new Error('AI Gateway Token未配置');
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
    
    // 获取API密钥
    const apiKey = this.getApiKey(provider);
    
    // 设置请求头
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    // 统一使用双层验证：Gateway Token + 提供商API Key
    headers['cf-aig-authorization'] = `Bearer ${this.gatewayToken}`;
    
    if (provider.toLowerCase() === 'google') {
      // Google使用特殊的API Key头部
      if (!apiKey) {
        throw new Error('Google API Key未配置');
      }
      headers['x-goog-api-key'] = apiKey;
    } else {
      // 其他所有提供商（包括Cloudflare）都使用Authorization头部
      if (!apiKey) {
        throw new Error(`${provider} API Key未配置`);
      }
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    
    console.log('发送AI Gateway请求', {
      provider,
      url,
      hasGatewayToken: !!this.gatewayToken,
      hasApiKey: !!apiKey,
      payloadPreview: JSON.stringify(payload).substring(0, 100) + '...'
    });
    
    // 发送请求
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    
    // 检查响应状态
    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway请求失败', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        url,
        headers: Object.keys(headers)
      });
      
      throw new Error(`AI Gateway请求失败: ${response.status} ${response.statusText}\n${errorText}`);
    }
    
    return await response.json();
  }
}
