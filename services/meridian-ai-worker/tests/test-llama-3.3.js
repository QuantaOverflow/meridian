#!/usr/bin/env node

const AI_WORKER_URL = 'http://localhost:8786';
const LLAMA_33_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

async function testRequest(endpoint, data, description) {
  console.log(`\n🧪 测试: ${description}`);
  console.log(`📍 端点: ${endpoint}`);
  
  try {
    const response = await fetch(`${AI_WORKER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ 成功 (${response.status})`);
      if (result.metadata?.model === LLAMA_33_MODEL) {
        console.log(`🎯 使用了 Llama 3.3 70B 模型`);
      }
      if (result.metadata?.processingTime) {
        console.log(`⏱️  处理时间: ${result.metadata.processingTime}ms`);
      }
      console.log(`📊 响应数据: ${JSON.stringify(result.data).substring(0, 200)}...`);
    } else {
      console.log(`❌ 失败 (${response.status}): ${result.error}`);
    }
  } catch (error) {
    console.log(`💥 请求错误: ${error.message}`);
  }
}

async function runTests() {
  console.log('🚀 开始测试 Llama 3.3 70B Instruct FP8 Fast 模型集成\n');
  
  // 测试 1: 基本聊天功能
  await testRequest('/meridian/chat', {
    messages: [
      { role: 'user', content: '你好！请介绍一下 Llama 3.3 模型的特点。' }
    ],
    options: {
      provider: 'workers-ai',
      model: LLAMA_33_MODEL,
      temperature: 0.7,
      max_tokens: 300
    }
  }, '基本聊天功能');

  // 测试 2: JSON 模式输出
  await testRequest('/meridian/chat', {
    messages: [
      { 
        role: 'system', 
        content: '你是一个 AI 技术专家。请以 JSON 格式回复，包含字段：{\"model_name\": \"\", \"key_features\": [], \"use_cases\": []}' 
      },
      { 
        role: 'user', 
        content: '分析 Llama 3.3 70B Instruct FP8 Fast 模型的技术特点和应用场景' 
      }
    ],
    options: {
      provider: 'workers-ai',
      model: LLAMA_33_MODEL,
      temperature: 0.3,
      max_tokens: 500
    }
  }, 'JSON 结构化输出');

  // 测试 3: 文章分析（应该优先使用 Llama 3.3）
  await testRequest('/meridian/article/analyze', {
    title: 'AI 模型性能对比分析',
    content: `随着大型语言模型的快速发展，模型性能和效率成为关键指标。Llama 3.3 70B 采用了 FP8 量化技术，
              在保持高质量输出的同时，显著提升了推理速度。该模型支持 24,000 tokens 的长上下文窗口，
              适合处理复杂的文档和对话任务。Function calling 功能使其能够与外部工具集成，
              扩展了应用场景。相比其他同类模型，Llama 3.3 在成本效益方面表现出色。`
  }, '文章分析功能');

  // 测试 4: 长文本处理能力
  const longText = '在人工智能快速发展的今天，'.repeat(100);
  await testRequest('/meridian/chat', {
    messages: [
      { 
        role: 'user', 
        content: `请总结以下长文本的主要观点：\n\n${longText}` 
      }
    ],
    options: {
      provider: 'workers-ai',
      model: LLAMA_33_MODEL,
      temperature: 0.5,
      max_tokens: 400
    }
  }, '长文本处理能力');

  // 测试 5: 多轮对话
  await testRequest('/meridian/chat', {
    messages: [
      { role: 'user', content: '什么是 FP8 量化？' },
      { role: 'assistant', content: 'FP8量化是一种模型压缩技术...' },
      { role: 'user', content: '它相比 FP16 有什么优势？' }
    ],
    options: {
      provider: 'workers-ai',
      model: LLAMA_33_MODEL,
      temperature: 0.6,
      max_tokens: 300
    }
  }, '多轮对话能力');

  // 测试 6: 代码生成
  await testRequest('/meridian/chat', {
    messages: [
      { 
        role: 'user', 
        content: '请生成一个 JavaScript 函数，用于调用 Cloudflare Workers AI API 并处理 Llama 3.3 模型的响应' 
      }
    ],
    options: {
      provider: 'workers-ai',
      model: LLAMA_33_MODEL,
      temperature: 0.2,
      max_tokens: 600
    }
  }, '代码生成能力');

  console.log('\n🏁 测试完成！');
  console.log('\n📋 总结:');
  console.log(`• 模型名称: ${LLAMA_33_MODEL}`);
  console.log('• 支持功能: 聊天、JSON输出、文章分析、长文本处理、多轮对话、代码生成');
  console.log('• 上下文窗口: 24,000 tokens');
  console.log('• 定价: $0.29/M input tokens, $2.25/M output tokens');
  console.log('• 特性: FP8量化、快速推理、Function calling支持');
}

// 运行测试
runTests().catch(console.error); 