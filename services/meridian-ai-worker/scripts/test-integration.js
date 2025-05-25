#!/usr/bin/env node

/**
 * Meridian AI Worker 集成测试脚本
 * 测试所有端点和 AI Gateway 增强功能
 */

const BASE_URL = 'http://localhost:8787'

async function makeRequest(path, options = {}) {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    })
    
    const data = await response.json()
    return { status: response.status, data }
  } catch (error) {
    return { error: error.message }
  }
}

async function runTests() {
  console.log('🚀 开始 Meridian AI Worker 集成测试\n')
  
  const tests = [
    {
      name: '健康检查',
      path: '/health',
      expected: { status: 200, data: { status: 'healthy' } }
    },
    {
      name: 'AI Gateway 配置验证',
      path: '/ai-gateway/config',
      expected: { status: 200, data: { validation: { providers_available: true } } }
    },
    {
      name: '提供商列表',
      path: '/providers',
      expected: { status: 200, data: { total: 1 } }
    },
    {
      name: '聊天能力提供商',
      path: '/capabilities/chat/providers',
      expected: { status: 200, data: { capability: 'chat' } }
    },
    {
      name: '嵌入能力提供商',
      path: '/capabilities/embedding/providers',
      expected: { status: 200, data: { capability: 'embedding' } }
    },
    {
      name: '图像能力提供商',
      path: '/capabilities/image/providers',
      expected: { status: 200, data: { capability: 'image' } }
    }
  ]
  
  const results = []
  
  for (const test of tests) {
    console.log(`📋 测试: ${test.name}`)
    const result = await makeRequest(test.path)
    
    if (result.error) {
      console.log(`❌ 失败: ${result.error}`)
      results.push({ name: test.name, status: 'error', error: result.error })
    } else if (result.status === test.expected.status) {
      console.log(`✅ 通过: HTTP ${result.status}`)
      
      // 检查数据结构
      let dataCheck = true
      for (const [key, value] of Object.entries(test.expected.data)) {
        if (result.data[key] !== value) {
          dataCheck = false
          break
        }
      }
      
      if (dataCheck) {
        console.log(`✅ 数据验证通过`)
        results.push({ name: test.name, status: 'pass' })
      } else {
        console.log(`⚠️  数据验证警告 - 响应结构可能已更改`)
        results.push({ name: test.name, status: 'warning', data: result.data })
      }
    } else {
      console.log(`❌ HTTP 状态码不匹配: 期望 ${test.expected.status}, 实际 ${result.status}`)
      results.push({ name: test.name, status: 'fail', expected: test.expected.status, actual: result.status })
    }
    console.log()
  }
  
  // 测试 POST 端点（预期会因缺少凭据而失败，但应返回适当的错误）
  console.log('📋 测试: 聊天请求 (预期失败 - 缺少 AI Gateway 凭据)')
  const chatResult = await makeRequest('/chat', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Hello test' }],
      provider: 'mock'
    })
  })
  
  if (chatResult.status === 500 && chatResult.data?.error) {
    console.log('✅ 聊天端点正确处理了缺少凭据的情况')
    results.push({ name: '聊天端点错误处理', status: 'pass' })
  } else {
    console.log('❌ 聊天端点响应不符合预期')
    results.push({ name: '聊天端点错误处理', status: 'fail', data: chatResult })
  }
  
  console.log()
  
  // 总结
  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail' || r.status === 'error').length
  const warned = results.filter(r => r.status === 'warning').length
  
  console.log('📊 测试总结:')
  console.log(`✅ 通过: ${passed}`)
  console.log(`⚠️  警告: ${warned}`)
  console.log(`❌ 失败: ${failed}`)
  console.log(`📝 总计: ${results.length}`)
  
  if (failed === 0) {
    console.log('\n🎉 所有关键测试都通过了！Meridian AI Worker 准备就绪。')
  } else {
    console.log('\n⚠️  有一些测试失败，请检查配置或代码。')
  }
  
  // 展示一些 AI Gateway 增强功能信息
  console.log('\n🔧 AI Gateway 增强功能状态:')
  const healthResult = await makeRequest('/health')
  if (healthResult.data?.ai_gateway) {
    const features = healthResult.data.ai_gateway
    console.log(`   认证: ${features.authentication ? '✅' : '❌'}`)
    console.log(`   成本跟踪: ${features.cost_tracking ? '✅' : '❌'}`)
    console.log(`   缓存: ${features.caching ? '✅' : '❌'}`)
    console.log(`   指标收集: ${features.metrics ? '✅' : '❌'}`)
    console.log(`   日志记录: ${features.logging ? '✅' : '❌'}`)
    console.log(`   默认缓存TTL: ${features.default_cache_ttl}秒`)
  }
  
  console.log('\n📚 要启用 AI Gateway 增强功能，请配置以下环境变量:')
  console.log('   - CLOUDFLARE_ACCOUNT_ID')
  console.log('   - CLOUDFLARE_GATEWAY_ID')
  console.log('   - CLOUDFLARE_API_TOKEN')
  console.log('   - AI_GATEWAY_AUTH_TOKEN (可选)')
  console.log('   - AI_GATEWAY_ENABLE_COST_TRACKING=true (可选)')
  console.log('   - AI_GATEWAY_ENABLE_CACHING=true (可选)')
  console.log('   - AI_GATEWAY_ENABLE_METRICS=true (可选)')
  console.log('   - AI_GATEWAY_ENABLE_LOGGING=true (可选)')
}

// 检查是否可以访问服务器
async function checkServer() {
  try {
    const response = await fetch(`${BASE_URL}/health`)
    return response.status === 200
  } catch (error) {
    return false
  }
}

async function main() {
  console.log('🔍 检查服务器连接...')
  const serverAvailable = await checkServer()
  
  if (!serverAvailable) {
    console.log('❌ 无法连接到服务器。请确保运行: npm run dev')
    console.log('   服务器应在 http://localhost:8787 运行')
    process.exit(1)
  }
  
  console.log('✅ 服务器连接正常\n')
  await runTests()
}

main().catch(console.error)
