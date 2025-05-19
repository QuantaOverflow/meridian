import OpenAI from 'openai';
import { Env, Provider } from '../types';
import { AIProvider } from './providerFactory';
import { getLogger } from '../utils/logger';
import { ApiError } from '../utils/errorHandler';

/**
 * OpenAI API 适配器
 * 实现 AIProvider 接口
 */
export class OpenAIProvider implements AIProvider {
  readonly provider = Provider.OPENAI;
  private env: Env;
  private client: OpenAI;
  private logger;

  constructor(env: Env) {
    this.env = env;
    this.logger = getLogger(env);

    if (!env.OPENAI_API_KEY) {
      throw new ApiError('OpenAI API key is required', 500);
    }

    try {
      this.client = new OpenAI({
        apiKey: env.OPENAI_API_KEY,
      });
      this.logger.debug('OpenAI client created');
    } catch (error) {
      this.logger.error('Failed to create OpenAI client', {}, error instanceof Error ? error : new Error(String(error)));
      throw new ApiError('Failed to initialize OpenAI client', 500);
    }
  }

  /**
   * 检查配置是否有效
   */
  checkConfig(): boolean {
    return Boolean(this.env.OPENAI_API_KEY && this.client);
  }

  /**
   * 文本生成方法
   */
  async generateText(prompt: string, options: Record<string, any> = {}): Promise<string> {
    const modelName = options.model || 'gpt-4o';
    const temperature = options.temperature ?? 0.2;
    const maxTokens = options.maxTokens;
    const startTime = Date.now();

    try {
      const completion = await this.client.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens,
      });

      const responseText = completion.choices[0]?.message?.content || '';
      
      // 收集使用量指标
      const usage = completion.usage;
      const duration = Date.now() - startTime;
      
      this.logger.info('Text generated with OpenAI', {
        model: modelName,
        promptLength: prompt.length,
        responseLength: responseText.length,
        durationMs: duration,
        tokens: {
          prompt: usage?.prompt_tokens,
          completion: usage?.completion_tokens,
          total: usage?.total_tokens,
        },
      });

      return responseText;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate text with OpenAI: ${errorMessage}`, {
        model: modelName,
        promptLength: prompt.length,
      }, error instanceof Error ? error : new Error(String(error)));
      
      throw new ApiError(`OpenAI text generation failed: ${errorMessage}`, 500);
    }
  }

  /**
   * 结构化数据生成
   * 使用函数调用（function calling）功能来生成结构化数据
   */
  async generateObject<T>(prompt: string, schema: Record<string, any>, options: Record<string, any> = {}): Promise<T> {
    const modelName = options.model || 'gpt-4o';
    const temperature = options.temperature ?? 0;
    const startTime = Date.now();

    try {
      // 将 JSON Schema 转换为 OpenAI 函数格式
      const functionName = 'generate_structured_data';
      
      // 构建基于 Schema 的 OpenAI 工具
      const tools = [
        {
          type: 'function',
          function: {
            name: functionName,
            description: 'Generate structured data based on the provided schema',
            parameters: schema,
          },
        },
      ];

      const response = await this.client.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        tools,
        tool_choice: { type: 'function', function: { name: functionName } },
        temperature,
      });

      // 提取函数调用结果
      const responseMessage = response.choices[0]?.message;
      
      if (!responseMessage || !responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
        throw new ApiError('OpenAI did not return a valid function call response', 500);
      }
      
      // 获取第一个工具调用
      const toolCall = responseMessage.tool_calls[0];
      
      // 解析返回的 JSON 字符串
      const result = JSON.parse(toolCall.function.arguments) as T;
      
      // 收集使用量指标
      const usage = response.usage;
      const duration = Date.now() - startTime;
      
      this.logger.info('Object generated with OpenAI', {
        model: modelName,
        promptLength: prompt.length,
        durationMs: duration,
        tokens: {
          prompt: usage?.prompt_tokens,
          completion: usage?.completion_tokens,
          total: usage?.total_tokens,
        },
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate object with OpenAI: ${errorMessage}`, {
        model: modelName,
        promptLength: prompt.length,
      }, error instanceof Error ? error : new Error(String(error)));
      
      throw new ApiError(`OpenAI object generation failed: ${errorMessage}`, 500);
    }
  }

  /**
   * 嵌入向量生成
   */
  async generateEmbedding(text: string, options: Record<string, any> = {}): Promise<number[]> {
    const modelName = options.model || 'text-embedding-3-large';
    const dimensions = options.dimensions || 1024;
    const startTime = Date.now();

    try {
      const response = await this.client.embeddings.create({
        model: modelName,
        input: text,
        dimensions,
      });

      if (!response.data || response.data.length === 0) {
        throw new ApiError('OpenAI returned empty embedding', 500);
      }
      
      const embedding = response.data[0].embedding;
      const duration = Date.now() - startTime;
      
      this.logger.info('Embedding generated with OpenAI', {
        model: modelName,
        textLength: text.length,
        embeddingDimensions: embedding.length,
        durationMs: duration,
        tokens: response.usage?.total_tokens,
      });

      return embedding;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate embedding with OpenAI: ${errorMessage}`, {
        model: modelName,
        textLength: text.length,
      }, error instanceof Error ? error : new Error(String(error)));
      
      throw new ApiError(`OpenAI embedding generation failed: ${errorMessage}`, 500);
    }
  }
}