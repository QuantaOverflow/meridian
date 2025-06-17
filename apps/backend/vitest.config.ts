import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    fileParallelism: false,
    poolOptions: {
      workers: {
        isolatedStorage: false,  // 工作流测试需要设置为 false
        wrangler: { 
          configPath: "./wrangler.test.jsonc" 
        },
        miniflare: {
          // 基本环境变量和绑定
          bindings: {
            API_TOKEN: "test-api-token-12345",
            GEMINI_API_KEY: "test-gemini-key-12345",
            DATABASE_URL: "postgresql://test:test@localhost:5432/test_db",
            HYPERDRIVE: {
              connectionString: "postgresql://test:test@localhost:5432/test_db"
            }
          },
          
          // 服务绑定 - 模拟AI Worker
          serviceBindings: {
            AI_WORKER(request: Request) {
              const url = new URL(request.url);
              const path = url.pathname;
              
              // 模拟 AI Worker 的不同端点
              if (path === '/meridian/article/analyze' && request.method === 'POST') {
                return new Response(JSON.stringify({
                  success: true,
                  data: {
                    language: 'en',
                    primary_location: 'global',
                    completeness: 'COMPLETE',
                    content_quality: 'OK',
                    event_summary_points: ['Major event occurred', 'Impact assessment'],
                    thematic_keywords: ['event', 'analysis', 'impact'],
                    topic_tags: ['politics', 'international'],
                    key_entities: ['Organization A', 'Person B'],
                    content_focus: ['policy', 'analysis'],
                  },
                }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' }
                });
              }
              
              if (path === '/meridian/embeddings/generate' && request.method === 'POST') {
                return new Response(JSON.stringify({
                  success: true,
                  data: [{ embedding: new Array(384).fill(0.123) }],
                }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' }
                });
              }
              
              // 健康检查端点
              if (path === '/health') {
                return new Response(JSON.stringify({
                  success: true,
                  status: 'healthy'
                }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' }
                });
              }
              
              // 默认响应
              return new Response(JSON.stringify({
                success: false,
                error: `Path ${path} not found in mock AI Worker`
              }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          },
          
          // 兼容性设置
          compatibilityDate: "2025-04-17",
          compatibilityFlags: ["nodejs_compat"]
        },
      },
    },
    
    // 测试超时
    testTimeout: 30000,
    
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'test/',
        '**/*.d.ts',
        '**/*.config.*',
        '.wrangler/',
        'docs/',
      ],
    },
    
    // 测试文件匹配
    include: [
      'test/**/*.{test,spec}.{js,ts}',
    ],
    
    // 排除文件
    exclude: [
      'node_modules/',
      'dist/',
      '.wrangler/',
      'docs/',
    ],
  },
  
  // 路径别名
  resolve: {
    alias: {
      '@/': './src/',
    },
  },
}); 