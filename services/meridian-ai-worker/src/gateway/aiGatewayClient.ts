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
   * 使用特定提供商API密钥发送请求
   * 此方法使用提供商自己的API密钥而非Gateway Token
   */
  async requestWithProviderKey<T = any>(
    provider: string, 
    endpoint: string, 
    payload: any, 
    options: Record<string, any> = {}
  ): Promise<T> {
    const url = `${this.gatewayUrl}/${provider}/${endpoint}`;
    console.log(`请求 Gateway(提供商密钥): ${url}`);
    
    // 获取该提供商的API密钥
    const apiKey = options.apiKey || this.apiKeys[provider] || '';
    if (!apiKey) {
      throw new Error(`未找到 ${provider} 的API密钥`);
    }
    
    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      
      // 添加Gateway认证头(如果配置了)
      if (this.gatewayToken) {
        headers['cf-aig-authorization'] = `Bearer ${this.gatewayToken}`;
      }
      
      // 添加缓存和元数据选项
      if (options['cf-aig-cache-ttl']) headers['cf-aig-cache-ttl'] = String(options['cf-aig-cache-ttl']);
      if (options['cf-aig-skip-cache']) headers['cf-aig-skip-cache'] = 'true';
      if (options['cf-aig-metadata']) headers['cf-aig-metadata'] = JSON.stringify(options['cf-aig-metadata']);

      console.log(`发送请求到 ${url}, 使用 ${provider} API密钥, 请求体:`, JSON.stringify(payload).slice(0, 200) + '...');
      
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      
      if (!resp.ok) {
        const errorText = await resp.text();
        console.error(`Gateway请求失败 [${resp.status}]: ${errorText}`);
        throw new Error(`Gateway请求失败 [${resp.status}]: ${errorText}`);
      }
      
      return await resp.json();
    } catch (error) {
      console.error(`Gateway请求异常:`, error);
      throw error;
    }
  }

  /**
   * 使用Gateway Token发送请求
   * 保留原有方法以兼容之前的代码
   */
  async request<T = any>(
    provider: string, 
    endpoint: string, 
    payload: any, 
    options: Record<string, any> = {}
  ): Promise<T> {
    const url = `${this.gatewayUrl}/${provider}/${endpoint}`;
    console.log(`请求 Gateway(Gateway Token): ${url}`);
    
    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.gatewayToken}`,
        'Content-Type': 'application/json',
      };
      
      if (options['cf-aig-cache-ttl']) headers['cf-aig-cache-ttl'] = String(options['cf-aig-cache-ttl']);
      if (options['cf-aig-skip-cache']) headers['cf-aig-skip-cache'] = 'true';
      if (options['cf-aig-metadata']) headers['cf-aig-metadata'] = JSON.stringify(options['cf-aig-metadata']);

      console.log(`发送请求到 ${url}, 请求体:`, JSON.stringify(payload).slice(0, 200) + '...');
      
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      
      if (!resp.ok) {
        const errorText = await resp.text();
        console.error(`Gateway请求失败 [${resp.status}]: ${errorText}`);
        throw new Error(`Gateway请求失败 [${resp.status}]: ${errorText}`);
      }
      
      return await resp.json();
    } catch (error) {
      console.error(`Gateway请求异常:`, error);
      throw error;
    }
  }
  
  /**
   * 获取指定提供商的格式化请求配置
   */
  getProviderConfig(providerName: string): {
    baseEndpoint: string;
    defaultModel: string;
    formatPayload: (prompt: string | any[], options: any) => any;
  } {
    const configs: Record<string, any> = {
      'openai': {
        baseEndpoint: 'v1/chat/completions',
        defaultModel: 'gpt-3.5-turbo',
        formatPayload: (prompt, options) => {
          const messages = Array.isArray(prompt) ? prompt : [{ role: 'user', content: prompt }];
          return {
            model: options.model || 'gpt-3.5-turbo',
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens
          };
        }
      },
      'anthropic': {
        baseEndpoint: 'v1/messages',
        defaultModel: 'claude-3-haiku-20240307',
        formatPayload: (prompt, options) => {
          // Anthropic格式
          if (Array.isArray(prompt)) {
            const systemMessage = prompt.find(m => m.role === 'system');
            const userMessages = prompt.filter(m => m.role !== 'system');
            
            return {
              model: options.model || 'claude-3-haiku-20240307',
              messages: userMessages,
              system: systemMessage?.content,
              temperature: options.temperature ?? 0.7,
              max_tokens: options.maxTokens || 1000
            };
          } else {
            return {
              model: options.model || 'claude-3-haiku-20240307',
              messages: [{ role: 'user', content: prompt }],
              temperature: options.temperature ?? 0.7,
              max_tokens: options.maxTokens || 1000
            };
          }
        }
      },
      'google': {
        baseEndpoint: 'v1/generateContent',
        defaultModel: 'gemini-1.5-pro',
        formatPayload: (prompt, options) => {
          // Google Gemini格式
          let contents;
          if (Array.isArray(prompt)) {
            contents = prompt.map(m => ({
              role: m.role,
              parts: [{ text: m.content }]
            }));
          } else {
            contents = [{ role: 'user', parts: [{ text: prompt }] }];
          }
          
          return {
            model: options.model || 'gemini-1.5-pro',
            contents,
            generationConfig: {
              temperature: options.temperature ?? 0.7,
              maxOutputTokens: options.maxTokens
            }
          };
        }
      }
    };
    
    return configs[providerName.toLowerCase()] || configs['openai'];
  }
}
