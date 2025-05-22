import { Env } from '../types';

export class AIGatewayClient {
  private gatewayUrl: string;
  private gatewayToken: string;
  private apiKeys: Record<string, string>;

  constructor(env: Env) {
    this.gatewayUrl = env.AI_GATEWAY_URL || `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_NAME}`;
    this.gatewayToken = env.AI_GATEWAY_TOKEN || '';
    
    // 初始化各提供商的API密钥
    this.apiKeys = {
      'openai': env.OPENAI_API_KEY || '',
      'anthropic': env.ANTHROPIC_API_KEY || '',
      'google': env.GOOGLE_API_KEY || '',
    };
    
    if (!this.gatewayUrl) {
      throw new Error('AI Gateway URL 必须配置');
    }
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
    
    // 保留提供商名称映射
    const providerMap: Record<string, string> = {
      'google': 'google-ai-studio',
      'openai': 'openai',
      'anthropic': 'anthropic',
      'cloudflare': 'cloudflare'
    };
    
    // 使用映射后的提供商名称
    const mappedProvider = providerMap[provider.toLowerCase()] || provider;
    
    // 使用映射后的提供商名构建URL
    const url = `${this.gatewayUrl}/${mappedProvider}/${endpoint}`;
    console.log(`请求 Gateway(提供商密钥): ${url} (原提供商: ${provider})`);
    
    // 获取该提供商的API密钥
    const apiKey = options.apiKey || this.apiKeys[provider] || '';
    if (!apiKey) {
      throw new Error(`未找到 ${provider} 的API密钥`);
    }
    
    try {
      // 创建基本头部
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // 添加Gateway Token认证头 - 这是关键修改
        'cf-aig-authorization': `Bearer ${this.gatewayToken}`
      };
      
      // 根据提供商设置不同的认证头
      if (provider.toLowerCase() === 'google') {
        // Google AI Studio 使用特殊的头格式
        headers['x-goog-api-key'] = apiKey;
      } else {
        // 其他提供商使用标准的 Bearer 认证
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      
      // 添加自定义选项，如缓存控制
      if (options['cf-aig-cache-ttl']) {
        headers['cf-aig-cache-ttl'] = String(options['cf-aig-cache-ttl']);
      }
      
      // 添加Debug日志
      console.log("发送请求到AI Gateway，认证信息:", { 
        provider, 
        mappedProvider,
        authHeaderType: provider.toLowerCase() === 'google' ? 'x-goog-api-key' : 'Authorization',
        hasGatewayToken: !!this.gatewayToken,
        hasApiKey: !!apiKey
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
        throw new Error(`Gateway请求失败 [${response.status}]: ${errorText}`);
      }
      
      return await response.json() as T;
    } catch (error) {
      console.error("Gateway请求异常:", error);
      throw error;
    }
  }


}
