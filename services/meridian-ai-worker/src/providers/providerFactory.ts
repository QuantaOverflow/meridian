import { Env, Provider } from '../types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { CloudflareAIProvider } from './cloudflareAI';
import { getLogger } from '../utils/logger';

/**
 * AI 提供商适配器接口
 * 所有具体的提供商实现都必须遵循此接口
 */
export interface AIProvider {
  /**
   * 提供商名称
   */
  readonly provider: Provider;
  
  /**
   * 检查配置是否有效
   */
  checkConfig(): boolean;
  
  /**
   * 文本生成方法
   */
  generateText(prompt: string, options?: Record<string, any>): Promise<string>;
  
  /**
   * 结构化数据生成
   */
  generateObject<T>(prompt: string, schema: Record<string, any>, options?: Record<string, any>): Promise<T>;
  
  /**
   * 嵌入向量生成
   */
  generateEmbedding(text: string, options?: Record<string, any>): Promise<number[]>;
}

/**
 * 根据提供商类型和环境创建适当的提供商实例
 */
export function createProvider(provider: Provider, env: Env): AIProvider {
  const logger = getLogger(env);
  
  logger.debug(`Creating provider of type: ${provider}`);
  
  switch (provider) {
    case Provider.OPENAI:
      if (!env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key not configured');
      }
      return new OpenAIProvider(env);
    
    case Provider.ANTHROPIC:
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error('Anthropic API key not configured');
      }
      return new AnthropicProvider(env);
    
    case Provider.GOOGLE:
      if (!env.GOOGLE_API_KEY) {
        throw new Error('Google API key not configured');
      }
      return new GeminiProvider(env);
    
    case Provider.CLOUDFLARE:
      if (!env.AI) {
        throw new Error('Cloudflare AI binding not configured');
      }
      return new CloudflareAIProvider(env);
    
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}