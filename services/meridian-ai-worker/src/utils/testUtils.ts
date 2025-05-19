/**
 * 测试辅助工具
 * 为项目提供测试和调试功能
 */

import { Env, TaskType } from '../types';

/**
 * 创建测试环境
 */
export function createTestEnv(): Env {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'test-openai-key',
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || 'test-google-key',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-anthropic-key',
    API_AUTH_KEY: process.env.API_AUTH_KEY || 'test-auth-key',
    ENVIRONMENT: 'test',
    LOG_LEVEL: 'debug',
    AI: {} // 模拟 Cloudflare AI 绑定
  };
}

/**
 * 生成测试请求样例
 */
export function generateSampleRequests() {
  return {
    // 文章分析请求样例
    articleAnalysis: {
      taskType: TaskType.ARTICLE_ANALYSIS,
      model: 'gemini-2.0-flash',
      title: '测试文章',
      content: '这是一篇测试用的文章内容，用于演示文章分析功能。',
      schema: {
        categories: ['技术', '新闻', '教育'],
        sentiment: ['positive', 'neutral', 'negative']
      }
    },
    
    // 嵌入向量生成请求样例
    embedding: {
      taskType: TaskType.EMBEDDING,
      model: 'text-embedding-3-large',
      text: '这是用于生成嵌入向量的测试文本。'
    },
    
    // 摘要生成请求样例
    summarize: {
      taskType: TaskType.SUMMARIZE,
      model: 'gpt-4o',
      content: '这是一段需要生成摘要的测试内容，内容比较长，需要AI模型进行摘要处理...',
      format: 'paragraph'
    },
    
    // 聊天请求样例
    chat: {
      taskType: TaskType.CHAT,
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: '你是一个客服助手，请提供简洁准确的回答。'
        },
        {
          role: 'user',
          content: '如何重置我的账户密码？'
        }
      ]
    }
  };
}

/**
 * 模拟请求头生成器
 */
export function createTestHeaders(authKey: string = 'test-auth-key') {
  return {
    'Authorization': `Bearer ${authKey}`,
    'Content-Type': 'application/json'
  };
}
