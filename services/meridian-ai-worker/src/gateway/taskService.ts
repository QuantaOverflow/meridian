import { Env, TaskType } from '../types';
import { AIGatewayClient } from './aiGatewayClient';
import { responseParser } from './responseParser';
import { modelService } from './modelService';

export class TaskService {
  private client: AIGatewayClient;
  
  constructor(private env: Env) {
    this.client = new AIGatewayClient(env);
  }
  
  /**
   * 执行文章分析任务
   */
  async analyzeArticle(title: string, content: string, options: Record<string, any> = {}): Promise<any> {
    console.log("分析文章任务开始", { title_length: title.length, content_length: content.length, options });
    
    // 计时开始
    const startTime = Date.now();
    
    try {
      // 1. 使用模型服务选择模型
      const modelConfig = modelService.selectModel(TaskType.ARTICLE_ANALYSIS, options);
      console.log("选择的模型配置", modelConfig);
      
      // 2. 构建请求提示
      const prompt = `分析以下文章的主要内容、主题、关键实体和情感倾向:\n\n标题: ${title}\n\n内容:\n${content}`;
      
      // 3. 使用模型服务格式化请求负载
      const payload = modelService.formatPayload(modelConfig, prompt, {
        ...options,
        model: modelConfig.name
      });
      
      // 4. 设置缓存和元数据
      const gatewayOptions = this.prepareCacheOptions(TaskType.ARTICLE_ANALYSIS, {
        provider: modelConfig.provider,
        model: modelConfig.name
      });
      
      // 5. 发送请求
      const response = await this.client.requestWithProviderKey(
        modelConfig.provider,
        modelConfig.endpoint || '',
        payload,
        gatewayOptions
      );
      
      // 6. 构建端点信息对象，用于传递给解析器
      const endpointInfo = {
        provider: modelConfig.provider,
        endpoint: modelConfig.endpoint || '',
        format: modelConfig.format || ''
      };
      
      // 7. 解析响应
      const result = responseParser.parseResponse(response, endpointInfo, TaskType.ARTICLE_ANALYSIS);
      
      // 8. 记录指标
      this.collectMetrics(TaskType.ARTICLE_ANALYSIS, modelConfig, startTime);
      
      return result;
    } catch (error) {
      console.error("Gateway请求失败", error);
      throw error;
    }
  }
  
  /**
   * 执行摘要生成任务
   */
  async summarize(text: string, options: Record<string, any> = {}): Promise<any> {
    console.log("摘要任务开始", { text_length: text.length, options });
    const startTime = Date.now();
    
    try {
      const modelConfig = modelService.selectModel(TaskType.SUMMARIZE, options);
      console.log("选择的模型配置", modelConfig);
      
      const prompt = `请为以下文本生成简洁摘要:\n\n${text}`;
      
      const payload = modelService.formatPayload(modelConfig, prompt, {
        ...options,
        model: modelConfig.name
      });
      
      const gatewayOptions = this.prepareCacheOptions(TaskType.SUMMARIZE, {
        provider: modelConfig.provider,
        model: modelConfig.name
      });
      
      
      const response = await this.client.requestWithProviderKey(
        modelConfig.provider,
        modelConfig.endpoint || '',
        payload,
        gatewayOptions
      );
      
      const endpointInfo = {
        provider: modelConfig.provider,
        endpoint: modelConfig.endpoint || '',
        format: modelConfig.format || ''
      };
      
      const result = responseParser.parseResponse(response, endpointInfo, TaskType.SUMMARIZE);
      
      this.collectMetrics(TaskType.SUMMARIZE, modelConfig, startTime);
      
      return result;
    } catch (error) {
      console.error("Gateway摘要请求失败", error);
      throw error;
    }
  }
  
  /**
   * 执行嵌入向量生成任务
   */
  async generateEmbedding(text: string, options: Record<string, any> = {}): Promise<any> {
    console.log("嵌入向量任务开始", { text_length: text.length, options });
    const startTime = Date.now();
    
    try {
      const modelConfig = modelService.selectModel(TaskType.EMBEDDING, options);
      console.log("选择的嵌入模型", modelConfig);
      
      const payload = modelService.formatPayload(modelConfig, text, {
        ...options,
        model: modelConfig.name
      });
      
      const gatewayOptions = this.prepareCacheOptions(TaskType.EMBEDDING, {
        provider: modelConfig.provider,
        model: modelConfig.name
      });
      
      const response = await this.client.requestWithProviderKey(
        modelConfig.provider,
        modelConfig.endpoint || '',
        payload,
        gatewayOptions
      );
      
      const endpointInfo = {
        provider: modelConfig.provider,
        endpoint: modelConfig.endpoint || '',
        format: modelConfig.format || ''
      };
      
      const result = responseParser.parseResponse(response, endpointInfo, TaskType.EMBEDDING);
      
      this.collectMetrics(TaskType.EMBEDDING, modelConfig, startTime);
      
      return result;
    } catch (error) {
      console.error("Gateway嵌入请求失败", error);
      throw error;
    }
  }
  
  /**
   * 聊天完成任务
   */
  async chatCompletion(messages: any[], options: Record<string, any> = {}): Promise<any> {
    console.log("聊天任务开始", { messages_count: messages.length, options });
    const startTime = Date.now();
    
    try {
      const modelConfig = modelService.selectModel(TaskType.CHAT, options);
      console.log("选择的聊天模型", modelConfig);
      
      const payload = modelService.formatPayload(modelConfig, messages, {
        ...options,
        model: modelConfig.name
      });
      
      const gatewayOptions = this.prepareCacheOptions(TaskType.CHAT, {
        provider: modelConfig.provider,
        model: modelConfig.name
      });
      
      const response = await this.client.requestWithProviderKey(
        modelConfig.provider,
        modelConfig.endpoint || '',
        payload,
        gatewayOptions
      );
      
      const endpointInfo = {
        provider: modelConfig.provider,
        endpoint: modelConfig.endpoint || '',
        format: modelConfig.format || ''
      };
      
      const result = responseParser.parseResponse(response, endpointInfo, TaskType.CHAT);
      
      this.collectMetrics(TaskType.CHAT, modelConfig, startTime);
      
      return result;
    } catch (error) {
      console.error("Gateway聊天请求失败", error);
      throw error;
    }
  }
  
  /**
   * 准备缓存选项和元数据
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
  
  /**
   * 收集性能指标
   */
  private collectMetrics(taskType: TaskType, modelConfig: any, startTime: number): void {
    const duration = Date.now() - startTime;
    console.log(`性能指标 - 任务:${taskType} 模型:${modelConfig.name} 提供商:${modelConfig.provider} 耗时:${duration}ms`);
  }
}