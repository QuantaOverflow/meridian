/**
 * 轻量级AI服务测试脚本
 * 验证解耦后的AI服务是否正常工作
 */

import { createAIServices, handleServiceResponse } from '../lib/ai-services';

// 模拟环境变量
const mockEnv = {
  AI_WORKER: {
    fetch: async (request: Request): Promise<Response> => {
      console.log(`[Mock AI Worker] ${request.method} ${request.url}`);
      
      if (request.url.includes('/health')) {
        return new Response(JSON.stringify({
          status: 'healthy',
          service: 'meridian-ai-worker',
          timestamp: new Date().toISOString()
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (request.url.includes('/embeddings/generate')) {
        return new Response(JSON.stringify({
          success: true,
          data: [{
            embedding: new Array(384).fill(0).map(() => Math.random() - 0.5)
          }],
          dimensions: 384
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (request.url.includes('/article/analyze')) {
        return new Response(JSON.stringify({
          success: true,
          data: {
            language: 'zh',
            primary_location: 'China',
            completeness: 'COMPLETE',
            content_quality: 'OK',
            event_summary_points: ['测试事件1', '测试事件2'],
            thematic_keywords: ['AI', '技术'],
            topic_tags: ['science', 'technology'],
            key_entities: ['测试实体'],
            content_focus: ['AI发展']
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      return new Response('Not Found', { status: 404 });
    }
  },
  MERIDIAN_ML_SERVICE_URL: 'https://mock-ml-service.com',
  MERIDIAN_ML_SERVICE_API_KEY: 'mock-api-key'
};

async function testAIServices() {
  console.log('🧪 开始测试轻量级AI服务...\n');
  
  const aiServices = createAIServices(mockEnv);
  
  // 测试1: AI Worker健康检查
  console.log('1️⃣ 测试AI Worker健康检查');
  try {
    const response = await aiServices.aiWorker.healthCheck();
    const result = await handleServiceResponse(response, 'AI Worker Health');
    console.log('✅ 健康检查结果:', result.success ? '成功' : '失败');
    if (result.success) {
      console.log('   数据:', result.data);
    } else {
      console.log('   错误:', result.error);
    }
  } catch (error) {
    console.log('❌ 健康检查异常:', error);
  }
  
  console.log();
  
  // 测试2: 嵌入生成
  console.log('2️⃣ 测试嵌入生成');
  try {
    const response = await aiServices.aiWorker.generateEmbedding('测试文本');
    const result = await handleServiceResponse<{success: boolean; data: Array<{embedding: number[]}>}>(response, 'Embedding Generation');
    console.log('✅ 嵌入生成结果:', result.success ? '成功' : '失败');
    if (result.success && result.data?.data?.[0]?.embedding) {
      console.log(`   维度: ${result.data.data[0].embedding.length}`);
      console.log(`   前3个值: ${result.data.data[0].embedding.slice(0, 3).map(v => v.toFixed(3)).join(', ')}`);
    } else {
      console.log('   错误:', result.error);
    }
  } catch (error) {
    console.log('❌ 嵌入生成异常:', error);
  }
  
  console.log();
  
  // 测试3: 文章分析
  console.log('3️⃣ 测试文章分析');
  try {
    const response = await aiServices.aiWorker.analyzeArticle('测试标题', '测试内容');
    const result = await handleServiceResponse(response, 'Article Analysis');
    console.log('✅ 文章分析结果:', result.success ? '成功' : '失败');
    if (result.success) {
      console.log('   数据:', JSON.stringify(result.data, null, 2));
    } else {
      console.log('   错误:', result.error);
    }
  } catch (error) {
    console.log('❌ 文章分析异常:', error);
  }
  
  console.log();
  
  // 测试4: 批量文本嵌入
  console.log('4️⃣ 测试批量文本嵌入（新功能）');
  try {
    const texts = ['文本1', '文本2', '文本3'];
    const response = await aiServices.aiWorker.generateEmbedding(texts);
    const result = await handleServiceResponse(response, 'Batch Embedding');
    console.log('✅ 批量嵌入结果:', result.success ? '成功' : '失败');
    if (result.success) {
      console.log(`   处理文本数量: ${texts.length}`);
    } else {
      console.log('   错误:', result.error);
    }
  } catch (error) {
    console.log('❌ 批量嵌入异常:', error);
  }
  
  console.log('\n🎉 AI服务测试完成！');
  console.log('\n📊 解耦优化总结:');
  console.log('   ✅ 移除了复杂的错误处理逻辑');
  console.log('   ✅ 简化了Result模式为Response转发');
  console.log('   ✅ 支持批量处理（string | string[]）');
  console.log('   ✅ 统一使用handleServiceResponse处理响应');
  console.log('   ✅ Backend专注于协调，不处理实现细节');
}

// 运行测试
if (require.main === module) {
  testAIServices().catch(console.error);
}

export { testAIServices }; 