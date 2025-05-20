import { Env, TaskType, ArticleAnalysisRequest, Provider } from '../types';
import { TaskProcessor } from './index';
import { MODELS, getDefaultModelForTask } from '../config/modelConfig';
import { createProvider } from '../providers/providerFactory';
import { getLogger } from '../utils/logger';
import { ApiError } from '../utils/errorHandler';
import { z } from 'zod';

// 导入文章分析 schema 和提示模板
import { articleAnalysisSchema, getArticleAnalysisPrompt } from '../schemas/article';

/**
 * 文章分析处理器
 * 实现 TaskProcessor 接口
 */
export class ArticleAnalyzer implements TaskProcessor<ArticleAnalysisRequest> {
  readonly taskType = TaskType.ARTICLE_ANALYSIS;
  private env: Env;
  private logger;
  
  constructor(env: Env) {
    this.env = env;
    this.logger = getLogger(env);
  }

  /**
   * 执行文章分析任务
   */
  async execute(request: ArticleAnalysisRequest): Promise<any> {
    const { title, content, model, schema, promptTemplate } = request;
    
    // 使用请求指定的模型或默认模型
    const selectedModel = model || getDefaultModelForTask(TaskType.ARTICLE_ANALYSIS);
    
    // 获取模型配置
    const modelConfig = MODELS[selectedModel];
    if (!modelConfig) {
      throw new ApiError(`Unknown model: ${selectedModel}`, 400);
    }
    
    // 验证模型是否支持文章分析
    if (!modelConfig.capabilities.includes(TaskType.ARTICLE_ANALYSIS)) {
      throw new ApiError(`Model ${selectedModel} does not support article analysis`, 400);
    }
    
    try {
      // 创建相应的提供商实例
      const provider = createProvider(modelConfig.provider, this.env);
      
      // 记录任务详情
      this.logger.info('Starting article analysis', {
        model: selectedModel,
        provider: modelConfig.provider,
        titleLength: title.length,
        contentLength: content.length,
        hasSchema: Boolean(schema),
        hasCustomPrompt: Boolean(promptTemplate),
      });

      // 准备提示 - 使用导入的提示模板函数或自定义模板
      let prompt;
      if (promptTemplate) {
        prompt = promptTemplate
          .replace(/{{TITLE}}/g, title)
          .replace(/{{CONTENT}}/g, content);
      } else {
        // 使用预定义的文章分析提示
        prompt = getArticleAnalysisPrompt(title, content);
      }

      // 确定使用哪个 schema
      const analysisSchema = schema || articleAnalysisSchema;
      
      // 使用提供商的 generateObject 方法进行分析，并标记为文章分析类型
      const result = await provider.generateObject(prompt, analysisSchema, {
        model: selectedModel,
        temperature: 0,
        analysisType: 'article', // 标识为文章分析，让 provider 正确处理 schema
      });
      
      // 记录完成信息
      this.logger.info('Article analysis completed successfully', {
        model: selectedModel,
        provider: modelConfig.provider,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Article analysis failed: ${errorMessage}`, {
        model: selectedModel,
        provider: modelConfig.provider,
        titleLength: title.length,
        contentLength: content.length,
      }, error instanceof Error ? error : new Error(String(error)));
      
      throw error;
    }
  }
}