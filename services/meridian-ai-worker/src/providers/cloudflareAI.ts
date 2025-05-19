import { Env, Provider } from '../types';
import { AIProvider } from './providerFactory';
import { getLogger } from '../utils/logger';
import { ApiError } from '../utils/errorHandler';

/**
 * Cloudflare AI 适配器
 * 实现 AIProvider 接口
 */
export class CloudflareAIProvider implements AIProvider {
  readonly provider = Provider.CLOUDFLARE;
  private env: Env;
  private logger;

  constructor(env: Env) {
    this.env = env;
    this.logger = getLogger(env);

    if (!env.AI) {
      throw new ApiError('Cloudflare AI binding is required', 500);
    }
  }

  /**
   * 检查配置是否有效
   */
  checkConfig(): boolean {
    return Boolean(this.env.AI);
  }

  /**
   * 文本生成方法
   * 注意：当前 Cloudflare AI 实现主要用于嵌入向量，此方法可能不适用于所有模型
   */
  async generateText(prompt: string, options: Record<string, any> = {}): Promise<string> {
    throw new ApiError('Text generation not implemented for Cloudflare AI provider', 501);
  }

  /**
   * 结构化数据生成
   * 注意：当前 Cloudflare AI 实现主要用于嵌入向量，此方法可能不适用于所有模型
   */
  async generateObject<T>(prompt: string, schema: Record<string, any>, options: Record<string, any> = {}): Promise<T> {
    throw new ApiError('Object generation not implemented for Cloudflare AI provider', 501);
  }

  /**
   * 嵌入向量生成
   * 使用 Cloudflare AI 绑定生成嵌入向量
   */
  async generateEmbedding(text: string, options: Record<string, any> = {}): Promise<number[]> {
    const modelName = options.model || '@cf/baai/bge-small-en-v1.5';
    const startTime = Date.now();

    try {
      // 调用 Cloudflare AI
      const response = await this.env.AI.run(modelName, {
        text
      });

      if (!response || !response.data || !response.data[0] || !Array.isArray(response.data[0])) {
        throw new ApiError('Cloudflare AI returned invalid embedding format', 500);
      }

      const embedding = response.data[0];
      const duration = Date.now() - startTime;
      
      this.logger.info('Embedding generated with Cloudflare AI', {
        model: modelName,
        textLength: text.length,
        embeddingDimensions: embedding.length,
        durationMs: duration,
      });

      return embedding;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate embedding with Cloudflare AI: ${errorMessage}`, {
        model: modelName,
        textLength: text.length,
      }, error instanceof Error ? error : new Error(String(error)));
      
      throw new ApiError(`Cloudflare AI embedding generation failed: ${errorMessage}`, 500);
    }
  }
}