import { Env, TaskType, ArticleAnalysisRequest, Provider } from '../types';
import { TaskProcessor } from './index';
import { MODELS, getDefaultModelForTask } from '../config/modelConfig';
import { createProvider } from '../providers/providerFactory';
import { getLogger } from '../utils/logger';
import { ApiError } from '../utils/errorHandler';

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

      // 准备提示
      let prompt = promptTemplate || `
Analyze the following article and extract key information:

Title: {{TITLE}}

Content:
{{CONTENT}}

Provide a structured analysis including:
1. Main topic or theme
2. Key entities mentioned (people, organizations, locations)
3. Primary claims or arguments
4. Sentiment and tone
5. Language identification
`;

      // 替换占位符
      prompt = prompt
        .replace(/{{TITLE}}/g, title)
        .replace(/{{CONTENT}}/g, content);

      // 使用提供商的 generateObject 方法进行分析
      const result = await provider.generateObject(prompt, schema || {});
      
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