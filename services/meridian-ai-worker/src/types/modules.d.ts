/**
 * 为缺少类型定义的模块提供模块声明
 */

// OpenAI
declare module 'openai' {
  export class OpenAI {
    constructor(options: { apiKey: string });
    chat: {
      completions: {
        create: (options: any) => Promise<any>;
      };
    };
  }
}

// Anthropic
declare module '@anthropic-ai/sdk' {
  export class Anthropic {
    constructor(options: { apiKey: string });
    messages: {
      create: (options: any) => Promise<any>;
    };
  }
}

// Google AI SDK
declare module '@ai-sdk/google' {
  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel: (options: any) => {
      generateContent: (options: any) => Promise<any>;
    };
  }
}
