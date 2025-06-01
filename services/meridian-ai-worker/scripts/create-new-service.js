#!/usr/bin/env node

/**
 * 新服务集成脚本
 * 用于快速生成新AI功能服务的模板代码
 * 
 * 使用方法:
 * node scripts/create-new-service.js [serviceName] [capability]
 * 
 * 示例:
 * node scripts/create-new-service.js document-summarization summarization
 */

const fs = require('fs')
const path = require('path')

// 获取命令行参数
const serviceName = process.argv[2]
const capability = process.argv[3]

if (!serviceName || !capability) {
  console.error('使用方法: node scripts/create-new-service.js <serviceName> <capability>')
  console.error('示例: node scripts/create-new-service.js document-summarization summarization')
  process.exit(1)
}

// 转换命名约定
const pascalCase = (str) => str.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())
const camelCase = (str) => str.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
const upperCase = (str) => str.toUpperCase().replace(/-/g, '_')

const ServiceName = pascalCase(serviceName)
const serviceCamel = camelCase(serviceName)
const CAPABILITY_UPPER = upperCase(capability)

console.log(`🚀 创建新的AI服务: ${ServiceName}`)
console.log(`📋 能力类型: ${capability}`)

// 1. 创建 Capability Handler 模板
const capabilityHandlerTemplate = `import { CapabilityHandler, ${ServiceName}Request, ${ServiceName}Response, ModelConfig } from '../types'

export class ${ServiceName}CapabilityHandler implements CapabilityHandler<${ServiceName}Request, ${ServiceName}Response> {
  capability: '${capability}' = '${capability}'

  buildProviderRequest(request: ${ServiceName}Request, model: ModelConfig): any {
    // TODO: 实现请求构建逻辑
    const prompt = this.build${ServiceName}Prompt(request)
    
    return {
      messages: [
        {
          role: 'system',
          content: '你是一个专业的AI助手。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: model.max_tokens || 4096,
      temperature: 0.3,
      stream: false
    }
  }

  parseProviderResponse(response: any, request: ${ServiceName}Request, model: ModelConfig): ${ServiceName}Response {
    // TODO: 实现响应解析逻辑
    const content = response.choices?.[0]?.message?.content || ''
    
    return {
      capability: '${capability}',
      id: \`${serviceCamel}_\${Date.now()}\`,
      provider: model.name.includes('@cf/') ? 'workers-ai' : 'openai',
      model: model.name,
      result: content.trim(),
      usage: response.usage
    }
  }

  private build${ServiceName}Prompt(request: ${ServiceName}Request): string {
    // TODO: 实现提示词构建逻辑
    return \`
请处理以下请求：

输入内容：
\${request.input}

要求：
- 保持专业和准确
- 提供清晰的结果

请提供处理结果：
\`.trim()
  }
}
`

// 2. 创建类型定义模板
const typesTemplate = `
// ${ServiceName} 相关类型定义
// 添加到 src/types.ts 文件中

// 1. 更新 AICapability 类型
export type AICapability = 'chat' | 'embedding' | 'image' | 'audio' | 'vision' | '${capability}'

// 2. 添加请求接口
export interface ${ServiceName}Request extends BaseAIRequest {
  capability: '${capability}'
  input: string
  // TODO: 添加特定的请求参数
  // options?: {
  //   maxLength?: number
  //   style?: string
  //   language?: string
  // }
}

// 3. 添加响应接口
export interface ${ServiceName}Response extends BaseAIResponse {
  capability: '${capability}'
  result: string
  // TODO: 添加特定的响应字段
  // metadata?: {
  //   processingTime?: number
  //   confidence?: number
  // }
}

// 4. 更新联合类型
export type AIRequest = ChatRequest | EmbeddingRequest | ImageRequest | AudioRequest | VisionRequest | ${ServiceName}Request
export type AIResponse = ChatResponse | EmbeddingResponse | ImageResponse | AudioResponse | VisionResponse | ${ServiceName}Response
`

// 3. 创建API端点模板
const endpointTemplate = `
// ${ServiceName} API 端点
// 添加到 src/index.ts 文件中

// =============================================================================
// ${ServiceName}
// =============================================================================

app.post('/meridian/${serviceName}', async (c) => {
  try {
    const body = await c.req.json()
    
    // 验证请求参数
    if (!body.input || typeof body.input !== 'string' || body.input.trim().length === 0) {
      return c.json({ 
        success: false,
        error: 'Invalid request: input is required and cannot be empty'
      }, 400)
    }

    // 创建AI Gateway Service
    const aiGatewayService = new AIGatewayService(c.env)
    
    // 构建请求
    const ${serviceCamel}Request = {
      input: body.input,
      provider: body.options?.provider || 'workers-ai',
      model: body.options?.model || '@cf/meta/llama-3.1-8b-instruct'
      // TODO: 添加其他参数
    }

    // 通过AI Gateway处理请求
    const result = await aiGatewayService.${serviceCamel}(${serviceCamel}Request)
    
    return c.json({
      success: true,
      data: {
        result: result.result
        // TODO: 添加其他响应字段
      },
      metadata: {
        provider: result.provider,
        model: result.model,
        processingTime: result.processingTime,
        cached: result.cached
      }
    })
  } catch (error: any) {
    console.error('${ServiceName} error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to process ${serviceName} request',
      details: error.message
    }, 500)
  }
})

// 批量处理端点
app.post('/meridian/${serviceName}/batch', async (c) => {
  try {
    const body = await c.req.json()
    
    // 验证请求参数
    if (!body.inputs || !Array.isArray(body.inputs) || body.inputs.length === 0) {
      return c.json({ 
        success: false,
        error: 'Invalid request: inputs array is required and cannot be empty'
      }, 400)
    }

    // 限制批量大小
    if (body.inputs.length > 10) {
      return c.json({ 
        success: false,
        error: 'Batch size too large: maximum 10 inputs per request'
      }, 400)
    }

    // 创建AI Gateway Service
    const aiGatewayService = new AIGatewayService(c.env)
    
    // 批量处理请求
    const results = await aiGatewayService.${serviceCamel}Batch(body.inputs, {
      provider: body.options?.provider,
      model: body.options?.model
    })
    
    return c.json({
      success: true,
      data: results.map(result => ({
        result: result.result
      })),
      metadata: {
        totalInputs: body.inputs.length,
        totalProcessingTime: results.reduce((sum, r) => sum + (r.processingTime || 0), 0)
      }
    })
  } catch (error: any) {
    console.error('Batch ${serviceName} error:', error)
    return c.json({ 
      success: false,
      error: 'Failed to process batch ${serviceName} requests',
      details: error.message
    }, 500)
  }
})
`

// 4. 创建AIGatewayService扩展模板
const serviceExtensionTemplate = `
// ${ServiceName} 服务扩展
// 添加到 src/services/ai-gateway.ts 文件中的 AIGatewayService 类

// 添加 ${serviceName} 便捷方法
async ${serviceCamel}(request: Omit<${ServiceName}Request, 'capability'>): Promise<${ServiceName}Response> {
  const result = await this.processRequest({ ...request, capability: '${capability}' })
  
  if (result.capability !== '${capability}') {
    throw new Error('Unexpected response type from ${serviceName} service')
  }
  
  return result as ${ServiceName}Response
}

// 批量 ${serviceName} 方法
async ${serviceCamel}Batch(inputs: string[], options?: {
  provider?: string
  model?: string
  // TODO: 添加其他选项
}): Promise<${ServiceName}Response[]> {
  const requests = inputs.map(input => ({
    input,
    provider: options?.provider,
    model: options?.model
  }))

  // 并行处理多个请求
  const results = await Promise.all(
    requests.map(request => this.${serviceCamel}(request))
  )

  return results
}
`

// 5. 创建Provider配置扩展模板
const providerConfigTemplate = `
// Provider 配置扩展
// 更新 src/config/providers.ts 文件

// 在相关模型的 capabilities 数组中添加 '${capability}'
// 示例:

{
  name: '@cf/meta/llama-3.1-8b-instruct',
  capabilities: ['chat', '${capability}'], // 添加新capability
  endpoint: '/ai/run/@cf/meta/llama-3.1-8b-instruct',
  max_tokens: 4096,
  supports_streaming: true,
  cost_per_token: { input: 0, output: 0 },
  ai_gateway_config: {
    cache_ttl: 3600, // 1小时缓存
    enable_cost_tracking: false,
    custom_tags: ['free', 'workers-ai', '${capability}']
  }
}
`

// 6. 创建测试模板
const testTemplate = `import { describe, it, expect, beforeEach } from 'vitest'
import { AIGatewayService } from '../src/services/ai-gateway'
import { ${ServiceName}CapabilityHandler } from '../src/capabilities/${serviceName}'

describe('${ServiceName} 功能', () => {
  let aiGatewayService: AIGatewayService
  let ${serviceCamel}Handler: ${ServiceName}CapabilityHandler

  beforeEach(() => {
    // 设置测试环境
    const mockEnv = {
      CLOUDFLARE_ACCOUNT_ID: 'test-account',
      CLOUDFLARE_GATEWAY_ID: 'test-gateway',
      CLOUDFLARE_API_TOKEN: 'test-token'
    }
    aiGatewayService = new AIGatewayService(mockEnv as any)
    ${serviceCamel}Handler = new ${ServiceName}CapabilityHandler()
  })

  it('应该处理${serviceName}请求', async () => {
    const request = {
      input: '测试输入内容'
      // TODO: 添加其他测试参数
    }

    const result = await aiGatewayService.${serviceCamel}(request)
    
    expect(result.capability).toBe('${capability}')
    expect(result.result).toBeDefined()
  })

  it('应该支持批量${serviceName}', async () => {
    const inputs = [
      '第一个输入内容',
      '第二个输入内容'
    ]

    const results = await aiGatewayService.${serviceCamel}Batch(inputs)
    
    expect(results).toHaveLength(2)
    expect(results[0].capability).toBe('${capability}')
    expect(results[1].capability).toBe('${capability}')
  })

  it('应该正确构建请求', () => {
    const request = {
      capability: '${capability}' as const,
      input: '测试输入'
    }
    
    const mockModel = {
      name: 'test-model',
      capabilities: ['${capability}'],
      endpoint: '/test',
      max_tokens: 1000
    }

    const providerRequest = ${serviceCamel}Handler.buildProviderRequest(request, mockModel)
    
    expect(providerRequest.messages).toBeDefined()
    expect(providerRequest.messages[0].role).toBe('system')
    expect(providerRequest.messages[1].role).toBe('user')
  })
})
`

// 创建目录结构
const outputDir = path.join(__dirname, '..', 'generated', serviceName)
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true })
}

// 写入文件
const files = [
  { name: `capabilities-${serviceName}.ts`, content: capabilityHandlerTemplate },
  { name: `types-${serviceName}.ts`, content: typesTemplate },
  { name: `endpoints-${serviceName}.ts`, content: endpointTemplate },
  { name: `service-extension-${serviceName}.ts`, content: serviceExtensionTemplate },
  { name: `provider-config-${serviceName}.ts`, content: providerConfigTemplate },
  { name: `${serviceName}.test.ts`, content: testTemplate }
]

files.forEach(file => {
  const filePath = path.join(outputDir, file.name)
  fs.writeFileSync(filePath, file.content, 'utf8')
  console.log(`✅ 创建文件: ${file.name}`)
})

// 生成集成清单
const checklistTemplate = `# ${ServiceName} 集成清单

## 📋 集成步骤

### 1. 类型定义 ✅
- [x] 生成类型定义模板
- [ ] 将 \`types-${serviceName}.ts\` 中的内容添加到 \`src/types.ts\`
- [ ] 根据具体需求调整接口定义

### 2. Capability Handler ✅
- [x] 生成 Capability Handler 模板
- [ ] 将 \`capabilities-${serviceName}.ts\` 移动到 \`src/capabilities/${serviceName}.ts\`
- [ ] 实现具体的业务逻辑

### 3. Provider 配置 ✅
- [x] 生成配置模板
- [ ] 按照 \`provider-config-${serviceName}.ts\` 更新 \`src/config/providers.ts\`
- [ ] 为支持的模型添加 '${capability}' capability

### 4. 服务扩展 ✅
- [x] 生成服务扩展模板
- [ ] 将 \`service-extension-${serviceName}.ts\` 中的方法添加到 \`AIGatewayService\` 类
- [ ] 根据需要调整方法签名

### 5. API 端点 ✅
- [x] 生成端点模板
- [ ] 将 \`endpoints-${serviceName}.ts\` 中的内容添加到 \`src/index.ts\`
- [ ] 调整验证逻辑和响应格式

### 6. 测试 ✅
- [x] 生成测试模板
- [ ] 将 \`${serviceName}.test.ts\` 移动到 \`tests/\` 目录
- [ ] 完善测试用例

## 🚀 部署前检查

- [ ] 所有TypeScript类型检查通过
- [ ] 单元测试覆盖率达标
- [ ] 集成测试通过
- [ ] API文档更新
- [ ] 错误处理完善
- [ ] 性能测试通过

## 📝 使用示例

\`\`\`typescript
// 基本用法
const result = await aiGatewayService.${serviceCamel}({
  input: '你的输入内容',
  provider: 'workers-ai',
  model: '@cf/meta/llama-3.1-8b-instruct'
})

// 批量处理
const results = await aiGatewayService.${serviceCamel}Batch([
  '输入1',
  '输入2'
], {
  provider: 'openai',
  model: 'gpt-4'
})
\`\`\`

## 🔗 相关文件

- \`src/types.ts\` - 类型定义
- \`src/capabilities/${serviceName}.ts\` - Capability Handler
- \`src/config/providers.ts\` - Provider 配置
- \`src/services/ai-gateway.ts\` - 服务扩展
- \`src/index.ts\` - API 端点
- \`tests/${serviceName}.test.ts\` - 测试用例

生成时间: ${new Date().toISOString()}
`

fs.writeFileSync(path.join(outputDir, 'README.md'), checklistTemplate, 'utf8')

console.log(`\n🎉 ${ServiceName} 服务模板创建完成！`)
console.log(`📁 输出目录: ${outputDir}`)
console.log(`📖 请查看 README.md 了解集成步骤`)
console.log(`\n下一步：`)
console.log(`1. 查看生成的模板文件`)
console.log(`2. 按照 README.md 中的清单逐步集成`)
console.log(`3. 根据具体需求调整代码`)
console.log(`4. 运行测试确保功能正常`) 