import Anthropic from '@anthropic-ai/sdk';
import { Env, Provider } from '../types';
import { AIProvider } from './providerFactory';
import { getLogger } from '../utils/logger';
import { ApiError } from '../utils/errorHandler';

/**
 * Anthropic API 适配器
 * 实现 AIProvider 接口
 */
export class AnthropicProvider implements AIProvider {
  readonly provider = Provider.ANTHROPIC;
  private env: Env;
  private client: Anthropic;
  private logger;

  constructor(env: Env) {
    this.env = env;
    this.logger = getLogger(env);

    if (!env.ANTHROPIC_API_KEY) {
      throw new ApiError('Anthropic API key is required', 500);
    }

    try {
      this.client = new Anthropic({
        apiKey: env.ANTHROPIC_API_KEY,
      });
      this.logger.debug('Anthropic client created');
    } catch (error) {
      this.logger.error('Failed to create Anthropic client', {}, error instanceof Error ? error : new Error(String(error)));
      throw new ApiError('Failed to initialize Anthropic client', 500);
    }
  }

  /**
   * 检查配置是否有效
   */
  checkConfig(): boolean {
    return Boolean(this.env.ANTHROPIC_API_KEY && this.client);
  }

  /**
   * 文本生成方法
   */
  async generateText(prompt: string, options: Record<string, any> = {}): Promise<string> {
    const modelName = options.model || 'claude-3-5-sonnet';
    const temperature = options.temperature ?? 0.2;
    const maxTokens = options.maxTokens || 4096;
    const startTime = Date.now();

    try {
      const message = await this.client.messages.create({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
      });

      // 提取生成的文本
      let responseText = '';
      if (message.content && message.content.length > 0) {
        // 合并所有文本块
        responseText = message.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');
      }
      
      // 收集使用量指标
      const duration = Date.now() - startTime;
      
      this.logger.info('Text generated with Anthropic', {
        model: modelName,
        promptLength: prompt.length,
        responseLength: responseText.length,
        durationMs: duration,
      });

      return responseText;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate text with Anthropic: ${errorMessage}`, {
        model: modelName,
        promptLength: prompt.length,
      }, error instanceof Error ? error : new Error(String(error)));
      
      throw new ApiError(`Anthropic text generation failed: ${errorMessage}`, 500);
    }
  }

  /**
   * 结构化数据生成
   * 使用 Anthropic 的工具调用（tool use）功能来生成结构化数据
   */
  async generateObject<T>(prompt: string, schema: Record<string, any>, options: Record<string, any> = {}): Promise<T> {
    const modelName = options.model || 'claude-3-5-sonnet';
    const temperature = options.temperature ?? 0;
    const startTime = Date.now();

    try {
      // 构造 Anthropic 工具定义
      const toolName = 'generate_structured_data';
      const tools = [
        {
          name: toolName,
          description: 'Generate structured data based on the provided schema',
          input_schema: schema,
        }
      ];

      const response = await this.client.messages.create({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        tools,
        tool_choice: { type: 'tool', name: toolName },
        temperature,
      });

      // 检查是否有工具调用
      if (!response.content || response.content.length === 0) {
        throw new ApiError('Anthropic did not return any content', 500);
      }
      
      // 查找工具调用响应
      const toolUse = response.content.find(
        block => block.type === 'tool_use' && block.name === toolName
      );
      
      if (!toolUse || toolUse.type !== 'tool_use' || !toolUse.input) {
        throw new ApiError('Anthropic did not return a valid tool use response', 500);
      }
      
      // 提取工具调用结果，默认已经是解析过的对象
      const result = toolUse.input as T;
      
      const duration = Date.now() - startTime;
      
      this.logger.info('Object generated with Anthropic', {
        model: modelName,
        promptLength: prompt.length,
        durationMs: duration,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate object with Anthropic: ${errorMessage}`, {
        model: modelName,
        promptLength: prompt.length,
      }, error instanceof Error ? error : new Error(String(error)));
      
      throw new ApiError(`Anthropic object generation failed: ${errorMessage}`, 500);
    }
  }

  /**
   * 嵌入向量生成
   * 注意：Anthropic 目前没有原生的嵌入 API，此方法为自定义实现
   */
  async generateEmbedding(text: string, options: Record<string, any> = {}): Promise<number[]> {
    // 注意：Anthropic 目前不提供嵌入 API
    this.logger.error('Embedding generation not supported by Anthropic');
    throw new ApiError('Embedding generation is not supported by Anthropic API', 501);
  }
}