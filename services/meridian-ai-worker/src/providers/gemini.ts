import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject as aiGenerateObject } from 'ai';
import { Env, Provider } from '../types';
import { AIProvider } from './providerFactory';
import { getLogger } from '../utils/logger';
import { ApiError } from '../utils/errorHandler';

// 添加自定义的 GenerativeModel 类型定义
type GenerativeModel = {
  // 文本生成方法
  generateContent(params: {
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    generationConfig?: {
      temperature?: number;
      maxOutputTokens?: number;
      topK?: number;
      topP?: number;
    };
  }): Promise<{
    response: {
      text(): string;
      promptFeedback?: {
        blockReason?: string;
        safetyRatings?: Array<{
          category: string;
          probability: string;
        }>;
      };
    };
  }>;
  
  // 嵌入向量生成方法
  embedContent(params: {
    content: Array<{ role: string; parts: Array<{ text: string }> }>;
  }): Promise<{
    embedding: {
      values: number[];
      dimensions?: number;
    };
  }>;
  
  // 添加可能被 generateObject 函数使用的其他属性
  name?: string;
  provider?: string;
  maxTokens?: number;
  
  // 接受 ai 包中 generateObject 函数可能用到的任何方法
  [key: string]: any;
};

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
      const model: GenerativeModel = this.client(modelName) as unknown as GenerativeModel; ;

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
   */
  async generateObject<T>(prompt: string, schema: Record<string, any>, options: Record<string, any> = {}): Promise<T> {
    const modelName = options.model || 'gemini-2.0-flash';
    const temperature = options.temperature ?? 0;
    const startTime = Date.now();

    try {
      // 不要给 model 添加类型断言，直接使用原始返回值
      const model = this.client(modelName);
      
      // 这里的调用方式与 processArticles.workflow.ts 中的相同
      const response = await (aiGenerateObject as any)({
        model,           // 使用原始模型，不进行类型转换
        temperature,
        prompt,
        schema,          // 直接传递 schema 参数
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
    const modelName = options.model || 'embedding-001'; // 确保使用支持嵌入的模型
    const startTime = Date.now();

    try {
      const model = this.client(modelName) as unknown as GenerativeModel;
      
      // 运行时检查模型是否支持嵌入
      if (typeof model.embedContent !== 'function') {
        throw new ApiError(`Model '${modelName}' does not support embeddings. Please use a dedicated embedding model like 'embedding-001'.`, 400);
      }
      
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