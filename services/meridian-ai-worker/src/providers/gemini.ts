import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject as aiGenerateObject } from 'ai';
import { Env, Provider } from '../types';
import { AIProvider } from './providerFactory';
import { getLogger } from '../utils/logger';
import { ApiError } from '../utils/errorHandler';
import { z } from 'zod';
// 导入文章分析 schema
import { articleAnalysisSchema } from '../schemas/article';

/**
 * Google Gemini API 适配器
 * 实现 AIProvider 接口
 */
export class GeminiProvider implements AIProvider {
  readonly provider = Provider.GOOGLE;
  private env: Env;
  private client: ReturnType<typeof createGoogleGenerativeAI>;
  private logger;

  constructor(env: Env) {
    this.env = env;
    this.logger = getLogger(env);

    if (!env.GOOGLE_API_KEY) {
      throw new ApiError('Google API key is required', 500);
    }

    try {
      this.client = createGoogleGenerativeAI({
        apiKey: env.GOOGLE_API_KEY,
      });
      this.logger.debug('Google Generative AI client created');
    } catch (error) {
      this.logger.error('Failed to create Google Generative AI client', {}, error instanceof Error ? error : new Error(String(error)));
      throw new ApiError('Failed to initialize Google Generative AI client', 500);
    }
  }

  /**
   * 检查配置是否有效
   */
  checkConfig(): boolean {
    return Boolean(this.env.GOOGLE_API_KEY && this.client);
  }

  /**
   * 文本生成方法
   */
  async generateText(prompt: string, options: Record<string, any> = {}): Promise<string> {
    const modelName = options.model || 'gemini-2.0-flash';
    const temperature = options.temperature ?? 0.2;
    const maxTokens = options.maxTokens;
    const startTime = Date.now();

    try {
      const model = this.client(modelName) as unknown as any;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      });

      const responseText = result.response.text();
      const duration = Date.now() - startTime;
      
      this.logger.info('Text generated with Gemini', {
        model: modelName,
        promptLength: prompt.length,
        responseLength: responseText.length,
        durationMs: duration,
      });

      return responseText;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate text with Gemini: ${errorMessage}`, {
        model: modelName,
        promptLength: prompt.length,
      }, error instanceof Error ? error : new Error(String(error)));
      
      throw new ApiError(`Gemini text generation failed: ${errorMessage}`, 500);
    }
  }

  /**
   * 结构化数据生成
   * 直接使用导入的 schema 定义
   */
  async generateObject<T>(prompt: string, schema: any, options: Record<string, any> = {}): Promise<T> {
    const modelName = options.model || 'gemini-2.0-flash';
    const temperature = options.temperature ?? 0;
    const startTime = Date.now();

    try {
      // 使用 AI SDK 原生方法
      const model = this.client(modelName);
      
      // 直接使用提供的 schema（假设它是 Zod schema）
      // 如果是文章分析，使用预定义的 schema
      const zodSchema = options.analysisType === 'article' ? 
        articleAnalysisSchema : 
        (schema instanceof z.ZodType ? schema : articleAnalysisSchema);
      
      // 记录调试信息
      this.logger.debug('Generating object with Gemini', {
        model: modelName,
        promptLength: prompt.length,
        analysisType: options.analysisType || 'generic'
      });
      
      // 使用 AI SDK 的 generateObject 方法生成结构化数据
      const response = await aiGenerateObject({
        model,
        prompt,
        temperature,
        maxTokens: options.maxTokens,
        schema: zodSchema,
      });
      
      const duration = Date.now() - startTime;
      this.logger.info('Object generated with Gemini', {
        model: modelName,
        promptLength: prompt.length,
        durationMs: duration,
      });

      return response.object as T;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate object with Gemini: ${errorMessage}`, {
        model: modelName,
        promptLength: prompt.length,
      }, error instanceof Error ? error : new Error(String(error)));
      
      throw new ApiError(`Gemini object generation failed: ${errorMessage}`, 500);
    }
  }

  /**
   * 嵌入向量生成
   */
  async generateEmbedding(text: string, options: Record<string, any> = {}): Promise<number[]> {
    const modelName = options.model || 'embedding-001';
    const startTime = Date.now();

    try {
      const model = this.client(modelName) as unknown as any;
      
      const embeddingResponse = await model.embedContent({
        content: [{ role: 'user', parts: [{ text }] }],
      });

      const embedding = embeddingResponse.embedding;
      
      if (!embedding || !embedding.values) {
        throw new ApiError('Google API returned empty embedding', 500);
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('Embedding generated with Gemini', {
        model: modelName,
        textLength: text.length,
        embeddingDimensions: embedding.values.length,
        durationMs: duration,
      });

      return embedding.values;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate embedding with Gemini: ${errorMessage}`, {
        model: modelName,
        textLength: text.length,
      }, error instanceof Error ? error : new Error(String(error)));
      
      throw new ApiError(`Gemini embedding generation failed: ${errorMessage}`, 500);
    }
  }
}