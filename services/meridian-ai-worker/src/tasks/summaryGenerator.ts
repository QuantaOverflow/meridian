import { Env, TaskType, SummaryRequest } from '../types';
import { TaskProcessor } from './index';
import { MODELS, getDefaultModelForTask } from '../config/modelConfig';
import { createProvider } from '../providers/providerFactory';
import { getLogger } from '../utils/logger';
import { ApiError } from '../utils/errorHandler';

/**
 * 摘要生成处理器
 * 实现 TaskProcessor 接口
 */
export class SummaryGenerator implements TaskProcessor<SummaryRequest, string> {
  readonly taskType = TaskType.SUMMARIZE;
  private env: Env;
  private logger;
  
  constructor(env: Env) {
    this.env = env;
    this.logger = getLogger(env);
  }

  /**
   * 执行摘要生成任务
   */
  async execute(request: SummaryRequest): Promise<string> {
    const { content, model, maxLength, format } = request;
    
    // 使用请求指定的模型或默认模型
    const selectedModel = model || getDefaultModelForTask(TaskType.SUMMARIZE);
    
    // 获取模型配置
    const modelConfig = MODELS[selectedModel];
    if (!modelConfig) {
      throw new ApiError(`Unknown model: ${selectedModel}`, 400);
    }
    
    // 验证模型是否支持摘要生成
    if (!modelConfig.capabilities.includes(TaskType.SUMMARIZE)) {
      throw new ApiError(`Model ${selectedModel} does not support summarization`, 400);
    }
    
    try {
      // 创建相应的提供商实例
      const provider = createProvider(modelConfig.provider, this.env);
      
      // 记录任务详情
      this.logger.info('Starting summary generation', {
        model: selectedModel,
        provider: modelConfig.provider,
        contentLength: content.length,
        maxLength,
        format,
      });
      
      // 准备摘要提示
      const summaryFormat = format || 'paragraph';
      const lengthInstruction = maxLength ? `approximately ${maxLength} words` : 'concise';
      
      let prompt = '';
      
      if (summaryFormat === 'bullet') {
        prompt = `
Please summarize the following content in ${lengthInstruction} key bullet points.
Focus on the most important information only.

------------------
${content}
------------------

Summary (in bullet points):
`;
      } else if (summaryFormat === 'json') {
        prompt = `
Please summarize the following content in a structured format.
Make the summary ${lengthInstruction}.
Focus on the most important information only.

------------------
${content}
------------------

Return the summary as a valid JSON object with these properties:
- main_points: Array of main points (3-5 items)
- key_entities: Array of important entities mentioned
- theme: Overall theme in one sentence
- sentiment: Overall sentiment (positive, negative, neutral, or mixed)

Ensure the JSON output is valid:
`;
      } else {
        // Default paragraph format
        prompt = `
Please summarize the following content in ${lengthInstruction}.
Focus on the most important information only.
Write in clear, concise paragraphs.

------------------
${content}
------------------

Summary:
`;
      }

      // 对于 JSON 格式，使用 generateObject 方法
      if (summaryFormat === 'json') {
        const schema = {
          type: 'object',
          properties: {
            main_points: {
              type: 'array',
              items: { type: 'string' }
            },
            key_entities: {
              type: 'array',
              items: { type: 'string' }
            },
            theme: { type: 'string' },
            sentiment: { type: 'string' }
          },
          required: ['main_points', 'theme']
        };
        
        const result = await provider.generateObject(prompt, schema);
        
        // 记录完成信息
        this.logger.info('JSON summary generation completed successfully', {
          model: selectedModel,
          provider: modelConfig.provider,
        });
        
        return JSON.stringify(result, null, 2);
      } else {
        // 对于文本格式，使用 generateText 方法
        const summary = await provider.generateText(prompt, { 
          model: selectedModel,
          temperature: 0.1 // 保持一致性
        });
        
        // 记录完成信息
        this.logger.info('Text summary generation completed successfully', {
          model: selectedModel,
          provider: modelConfig.provider,
          summaryLength: summary.length,
        });
        
        return summary;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Summary generation failed: ${errorMessage}`, {
        model: selectedModel,
        provider: modelConfig.provider,
        contentLength: content.length,
      }, error instanceof Error ? error : new Error(String(error)));
      
      throw error;
    }
  }
}