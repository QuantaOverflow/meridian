// BGE-M3 模型测试脚本
// 测试多语言嵌入模型的集成

async function testBGEM3() {
  const baseUrl = 'https://meridian-ai-worker.swj299792458.workers.dev'; // 或者你的开发服务器地址
  
  console.log('🚀 开始测试 BGE-M3 模型集成...\n');

  // 测试 1: 标准文本嵌入（英文）
  console.log('📝 测试 1: 英文文本嵌入');
  try {
    const response1 = await fetch(`${baseUrl}/meridian/embeddings/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: "This is a test sentence for embedding generation.",
        options: {
          provider: 'workers-ai',
          model: '@cf/baai/bge-m3'
        }
      })
    });
    
    const result1 = await response1.json();
    console.log("Raw response for Test 1:", result1);
    if (result1.success) {
      console.log('✅ 英文嵌入生成成功');
      console.log(`   维度: ${result1.dimensions || 0}`);
      console.log(`   数据点数: ${result1.data_points || 0}`);
      console.log(`   处理时间 (总): ${result1.metadata?.processingTime || 'N/A'}ms`);
      console.log(`   处理时间 (AI): ${result1.metadata?.performance?.latency?.totalLatency || 'N/A'}ms\n`);
    } else {
      console.log('❌ 英文嵌入生成失败');
      console.log(`   错误: ${result1.error}`);
      console.log(`   详情: ${result1.details}\n`);
    }
  } catch (error) {
    console.error('❌ 英文嵌入测试失败:', error.message);
  }

  // 测试 2: 多语言文本嵌入（中文）
  console.log('📝 测试 2: 中文文本嵌入');
  try {
    const response2 = await fetch(`${baseUrl}/meridian/embeddings/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: "这是一个用于生成嵌入向量的中文测试句子。",
        options: {
          provider: 'workers-ai',
          model: '@cf/baai/bge-m3'
        }
      })
    });
    
    const result2 = await response2.json();
    console.log("Raw response for Test 2:", result2);
    if (result2.success) {
      console.log('✅ 中文嵌入生成成功');
      console.log(`   维度: ${result2.dimensions || 0}`);
      console.log(`   数据点数: ${result2.data_points || 0}`);
      console.log(`   处理时间 (总): ${result2.metadata?.processingTime || 'N/A'}ms`);
      console.log(`   处理时间 (AI): ${result2.metadata?.performance?.latency?.totalLatency || 'N/A'}ms\n`);
    } else {
      console.log('❌ 中文嵌入生成失败');
      console.log(`   错误: ${result2.error}`);
      console.log(`   详情: ${result2.details}\n`);
    }
  } catch (error) {
    console.error('❌ 中文嵌入测试失败:', error.message);
  }

  // 测试 3: 批量文本嵌入
  console.log('📝 测试 3: 批量多语言文本嵌入');
  try {
    const response3 = await fetch(`${baseUrl}/meridian/embeddings/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: [
          "This is an English sentence.",
          "这是一个中文句子。",
          "これは日本語の文です。",
          "Esto es una oración en español."
        ],
        options: {
          provider: 'workers-ai',
          model: '@cf/baai/bge-m3'
        }
      })
    });
    
    const result3 = await response3.json();
    console.log("Raw response for Test 3:", result3);
    if (result3.success) {
      console.log('✅ 批量多语言嵌入生成成功');
      console.log(`   维度: ${result3.dimensions || 0}`);
      console.log(`   数据点数: ${result3.data_points || 0}`);
      console.log(`   处理时间 (总): ${result3.metadata?.processingTime || 'N/A'}ms`);
      console.log(`   处理时间 (AI): ${result3.metadata?.performance?.latency?.totalLatency || 'N/A'}ms\n`);
    } else {
      console.log('❌ 批量嵌入生成失败');
      console.log(`   错误: ${result3.error}`);
      console.log(`   详情: ${result3.details}\n`);
    }
  } catch (error) {
    console.error('❌ 批量嵌入测试失败:', error.message);
  }

  // 测试 4: 查询和上下文格式（如果实现了）
  console.log('📝 测试 4: 查询和上下文格式（BGE-M3 特有功能）');
  try {
    const response4 = await fetch(`${baseUrl}/meridian/embeddings/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: "AI technology",
        contexts: [
          { text: "Artificial intelligence is transforming the world." },
          { text: "Machine learning is a subset of AI." },
          { text: "Cooking is a culinary art form." }
        ],
        options: {
          provider: 'workers-ai',
          model: '@cf/baai/bge-m3'
        }
      })
    });
    
    const result4 = await response4.json();
    console.log("Raw response for Test 4:", result4);
    if (result4.success) {
      console.log('✅ 查询和上下文处理成功');
      console.log(`   维度: ${result4.dimensions || 0}`);
      console.log(`   相关性评分数量: ${result4.data_points || 0}`);
      console.log(`   处理时间 (总): ${result4.metadata?.processingTime || 'N/A'}ms`);
      console.log(`   处理时间 (AI): ${result4.metadata?.performance?.latency?.totalLatency || 'N/A'}ms\n`);
    } else {
      console.log('❌ 查询和上下文处理失败');
      console.log(`   错误: ${result4.error}`);
      console.log(`   详情: ${result4.details}\n`);
    }
  } catch (error) {
    console.error('❌ 查询和上下文测试失败:', error.message);
  }

  // 测试 5: 模型配置验证
  console.log('📝 测试 5: 验证 BGE-M3 模型配置');
  try {
    const response5 = await fetch(`${baseUrl}/health`, {
      method: 'GET'
    });
    
    const responseText = await response5.text();
    console.log('原始响应:', responseText.substring(0, 100) + '...');
    
    const result5 = JSON.parse(responseText);
    console.log('✅ 健康检查通过');
    console.log(`   状态: ${result5.status}`);
    console.log(`   服务: ${result5.service}`);
    console.log(`   时间戳: ${result5.timestamp}`);
    console.log(`   处理时间 (总): ${result5.metadata?.processingTime || 'N/A'}ms`);
    console.log(`   处理时间 (AI): ${result5.metadata?.performance?.latency?.totalLatency || 'N/A'}ms\n`);
    
  } catch (error) {
    console.error('❌ 健康检查失败:', error.message);
  }

  console.log('\n🎉 BGE-M3 模型测试完成！');
}

// 运行测试
testBGEM3().catch(console.error); 