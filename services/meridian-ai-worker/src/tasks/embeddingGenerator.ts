import { Env, TaskType, EmbeddingRequest } from '../types';
import { TaskProcessor } from './index';
import { MODELS, getDefaultModelForTask } from '../config/modelConfig';
import { createProvider } from '../providers/providerFactory';
import { getLogger } from '../utils/logger';
import { ApiError } from '../utils/errorHandler';

/**
 * 嵌入向量生成处理器
 * 实现 TaskProcessor 接口
 */
export class EmbeddingGenerator implements TaskProcessor<EmbeddingRequest, number[]> {
  readonly taskType = TaskType.EMBEDDING;
  private env: Env;
  private logger;
  
  constructor(env: Env) {
    this.env = env;
    this.logger = getLogger(env);
  }

  /**
   * 执行嵌入向量生成任务
   */
  async execute(request: EmbeddingRequest): Promise<number[]> {
    const { text, model, dimensions } = request;
    
    // 使用请求指定的模型或默认模型
    const selectedModel = model || getDefaultModelForTask(TaskType.EMBEDDING);
    
    // 获取模型配置
    const modelConfig = MODELS[selectedModel];
    if (!modelConfig) {
      throw new ApiError(`Unknown model: ${selectedModel}`, 400);
    }
    
    // 验证模型是否支持嵌入向量生成
    if (!modelConfig.capabilities.includes(TaskType.EMBEDDING)) {
      throw new ApiError(`Model ${selectedModel} does not support embedding generation`, 400);
    }
    
    try {
      // 创建相应的提供商实例
      const provider = createProvider(modelConfig.provider, this.env);
      
      // 记录任务详情
      this.logger.info('Starting embedding generation', {
        model: selectedModel,
        provider: modelConfig.provider,
        textLength: text.length,
        dimensions,
      });

      // 生成嵌入向量
      const embedding = await provider.generateEmbedding(text, {
        model: selectedModel,
        dimensions,
      });
      
      // 记录完成信息
      this.logger.info('Embedding generation completed successfully', {
        model: selectedModel,
        provider: modelConfig.provider,
        embeddingLength: embedding.length,
      });

      return embedding;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Embedding generation failed: ${errorMessage}`, {
        model: selectedModel,
        provider: modelConfig.provider,
        textLength: text.length,
      }, error instanceof Error ? error : new Error(String(error)));
      
      throw error;
    }
  }
}