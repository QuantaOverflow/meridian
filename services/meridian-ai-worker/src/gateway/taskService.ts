import { Env, TaskType } from '../types';
import { AIGatewayClient } from './aiGatewayClient';
import { modelSelector } from './modelSelector';
import { endpointMapper } from './endpointMapper';
import { responseParser } from './responseParser';

export class TaskService {
  private client: AIGatewayClient;
  
  constructor(private env: Env) {
    this.client = new AIGatewayClient(env);
  }
  
  /**
   * 执行文章分析任务
   */
  async analyzeArticle(title: string, content: string, options: Record<string, any> = {}): Promise<any> {
    // 添加详细日志
    console.log("分析文章任务开始", { title_length: title.length, content_length: content.length, options });
    
    try {
      // 1. 确定最佳模型 - 由任务类型决定
      const modelInfo = modelSelector.getModelForTask(TaskType.ARTICLE_ANALYSIS, options);
      console.log("选择的模型信息", modelInfo);
      
      // 2. 确定适当的路由端点和格式 - 由模型和任务类型决定
      const endpointInfo = endpointMapper.getEndpointInfo(modelInfo.provider, modelInfo.model, TaskType.ARTICLE_ANALYSIS);
      console.log("选择的端点信息", endpointInfo);
      
      // 3. 构建请求 - 由确定的端点格式决定
      const prompt = `分析以下文章的主要内容、主题、关键实体和情感倾向:\n\n标题: ${title}\n\n内容:\n${content}`;
      const payload = endpointMapper.formatPayload(endpointInfo, prompt, {
        ...options,
        model: modelInfo.model
      });
      
      // 4. 设置缓存和元数据
      const gatewayOptions = this.prepareCacheOptions(TaskType.ARTICLE_ANALYSIS, modelInfo);
      
      // 5. 发送请求 - 由确定的供应商决定
      const response = await this.client.requestWithProviderKey(
        endpointInfo.provider,
        endpointInfo.endpoint,
        payload,
        gatewayOptions
      );
      
      // 6. 解析响应 - 由确定的端点格式决定
      return responseParser.parseResponse(response, endpointInfo, TaskType.ARTICLE_ANALYSIS);
    } catch (error) {
      console.error("Gateway请求失败", error);
      throw error;
    }
  }
  
  // 其他方法类似实现...
  /**
   * 准备缓存选项和元数据
   * @private
   */
  private prepareCacheOptions(taskType: TaskType, modelInfo: any): Record<string, any> {
    const options: Record<string, any> = {};
    const cacheConfig = this.getCacheConfigForTask(taskType);
    
    if (cacheConfig) {
      options['cf-aig-cache-ttl'] = cacheConfig.ttl;
      options['cf-aig-metadata'] = {
        ...cacheConfig.metadata,
        model: modelInfo.model,
        provider: modelInfo.provider,
        taskType
      };
    }
    
    return options;
  }
  
  /**
   * 获取任务的缓存配置
   * @private
   */
  private getCacheConfigForTask(taskType: TaskType): { ttl: number, metadata: Record<string, any> } | null {
    switch(taskType) {
      case TaskType.ARTICLE_ANALYSIS:
        return { ttl: 86400, metadata: { type: 'analysis' } };
      case TaskType.SUMMARIZE:
        return { ttl: 86400, metadata: { type: 'summary' } };
      case TaskType.EMBEDDING:
        return { ttl: 604800, metadata: { type: 'embedding' } };
      case TaskType.CHAT:
        return null; // 聊天不缓存
      default:
        return null;
    }
  }
}