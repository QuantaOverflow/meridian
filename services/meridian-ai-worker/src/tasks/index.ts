import { Env, TaskType, TaskRequest } from '../types';
import { ArticleAnalyzer } from './articleAnalyzer';
import { EmbeddingGenerator } from './embeddingGenerator';
import { SummaryGenerator } from './summaryGenerator';
import { ChatProcessor } from './chatProcessor';
import { getLogger } from '../utils/logger';
import { ApiError } from '../utils/errorHandler';

/**
 * 任务处理器接口
 * 所有具体的任务处理器都必须实现此接口
 */
export interface TaskProcessor<TRequest extends TaskRequest, TResponse = any> {
  /**
   * 返回此处理器支持的任务类型
   */
  readonly taskType: TaskType;
  
  /**
   * 执行任务
   */
  execute(request: TRequest): Promise<TResponse>;
}

/**
 * 任务处理器工厂
 * 根据任务类型创建相应的处理器实例
 */
export function taskFactory<TRequest extends TaskRequest, TResponse = any>(
  taskType: TaskType, 
  env: Env
): TaskProcessor<TRequest, TResponse> {
  const logger = getLogger(env);
  
  logger.debug(`Creating task processor for task type: ${taskType}`);
  
  switch (taskType) {
    case TaskType.ARTICLE_ANALYSIS:
      return new ArticleAnalyzer(env) as unknown as TaskProcessor<TRequest, TResponse>;
    
    case TaskType.EMBEDDING:
      return new EmbeddingGenerator(env) as unknown as TaskProcessor<TRequest, TResponse>;
    
    case TaskType.SUMMARIZE:
      return new SummaryGenerator(env) as unknown as TaskProcessor<TRequest, TResponse>;
    
    case TaskType.CHAT:
      return new ChatProcessor(env) as unknown as TaskProcessor<TRequest, TResponse>;
    
    default:
      logger.error(`Unsupported task type: ${taskType}`);
      throw new ApiError(`Unsupported task type: ${taskType}`, 400);
  }
}