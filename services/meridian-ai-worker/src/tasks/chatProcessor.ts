import { Env, TaskType, ChatRequest, ChatResponse } from '../types';
import { TaskProcessor } from './index';
import { getLogger } from '../utils/logger';
import { MODELS } from '../config/modelConfig';
import { ApiError } from '../utils/errorHandler';

/**
 * 聊天处理器
 * 处理聊天相关任务，调用适当的 AI 提供商 API
 */
export class ChatProcessor implements TaskProcessor<ChatRequest, ChatResponse> {
  readonly taskType = TaskType.CHAT;
  private env: Env;
  private logger;

  constructor(env: Env) {
    this.env = env;
    this.logger = getLogger(env);
  }

  async execute(request: ChatRequest): Promise<ChatResponse> {
    this.logger.debug('Processing chat request', { 
      model: request.model, 
      messagesCount: request.messages.length 
    });

    // 获取模型配置
    const model = request.model || '';
    const modelConfig = MODELS[model];
    
    if (!modelConfig) {
      throw new ApiError(`Invalid model: ${model}`, 400);
    }
    
    // 根据不同提供商调用相应的 API
    switch (modelConfig.provider) {
      case 'openai':
        return this.handleOpenAIChat(request);
      
      case 'anthropic':
        return this.handleAnthropicChat(request);
      
      case 'google':
        return this.handleGoogleChat(request);
      
      default:
        throw new ApiError(`Chat is not supported for provider: ${modelConfig.provider}`, 400);
    }
  }

  private async handleOpenAIChat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.env.OPENAI_API_KEY) {
      throw new ApiError('OpenAI API key is not configured', 500);
    }

    try {
      // 使用 any 类型来避免导入类型错误
      const { OpenAI } = await import('openai') as any;
      const openai = new OpenAI({ apiKey: this.env.OPENAI_API_KEY });

      const response = await openai.chat.completions.create({
        model: request.model!,
        messages: request.messages,
        temperature: request.temperature || 0.7,
        max_tokens: request.maxTokens
      });

      return {
        message: {
          role: 'assistant',
          content: response.choices[0].message.content || ''
        },
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0
        }
      };
    } catch (error) {
      this.logger.error('OpenAI chat error', {}, error as Error);
      throw new ApiError(`OpenAI API error: ${(error as Error).message}`, 500);
    }
  }

  private async handleAnthropicChat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.env.ANTHROPIC_API_KEY) {
      throw new ApiError('Anthropic API key is not configured', 500);
    }

    try {
      // 使用 any 类型来避免导入类型错误
      const { Anthropic } = await import('@anthropic-ai/sdk') as any;
      const anthropic = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

      // 将请求消息转换为 Anthropic 格式
      const systemMessage = request.messages.find(m => m.role === 'system');
      const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

      const response = await anthropic.messages.create({
        model: request.model!,
        messages: nonSystemMessages as any,
        system: systemMessage?.content,
        max_tokens: request.maxTokens || 1024,
        temperature: request.temperature || 0.7
      });

      return {
        message: {
          role: 'assistant',
          content: response.content[0].text
        },
        usage: {
          promptTokens: response.usage?.input_tokens || 0,
          completionTokens: response.usage?.output_tokens || 0,
          totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
        }
      };
    } catch (error) {
      this.logger.error('Anthropic chat error', {}, error as Error);
      throw new ApiError(`Anthropic API error: ${(error as Error).message}`, 500);
    }
  }

  private async handleGoogleChat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.env.GOOGLE_API_KEY) {
      throw new ApiError('Google API key is not configured', 500);
    }

    try {
      // 使用 any 类型来避免导入类型错误
      const { GoogleGenerativeAI } = await import('@ai-sdk/google') as any;
      const genAI = new GoogleGenerativeAI(this.env.GOOGLE_API_KEY);

      // 转换消息格式
      const systemMessage = request.messages.find(m => m.role === 'system')?.content || '';
      const userMessages = request.messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, parts: [{ text: m.content }] }));

      const model = genAI.getGenerativeModel({
        model: request.model!,
        systemInstruction: systemMessage
      });

      const response = await model.generateContent({
        contents: userMessages as any,
        generationConfig: {
          temperature: request.temperature || 0.7,
          maxOutputTokens: request.maxTokens
        }
      });

      const result = response.response;
      const text = result.text();

      return {
        message: {
          role: 'assistant',
          content: text
        },
        // Google API 目前不返回详细的使用情况信息
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0
        }
      };
    } catch (error) {
      this.logger.error('Google chat error', {}, error as Error);
      throw new ApiError(`Google API error: ${(error as Error).message}`, 500);
    }
  }
}
