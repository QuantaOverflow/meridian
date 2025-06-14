import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true, // 启用全局测试函数（describe, it, expect）
    // 强制顺序执行，避免并发资源冲突
    fileParallelism: false,
    poolOptions: {
      workers: {
        // 为了支持 Workflows，需要禁用 isolated storage
        isolatedStorage: false,
        // 使用测试专用的 wrangler 配置文件
        wrangler: { 
          configPath: "./wrangler.test.jsonc" 
        },
        // 最小化的 Miniflare 配置
        miniflare: {
          // 基本的环境变量
          bindings: {
            API_TOKEN: "test-api-token",
            GEMINI_API_KEY: "test-gemini-key",
            DATABASE_URL: "postgresql://test:test@localhost:5432/test_db",
          },
          
          // 兼容性日期和标志 - 使用支持的日期
          compatibilityDate: "2025-04-17",
          compatibilityFlags: ["nodejs_compat"],
          
          // 禁用一些可能导致冲突的功能
          queueConsumers: {},
        },
      },
    },
    
    // 测试超时设置
    testTimeout: 30000, // 30 秒
    
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
      thresholds: {
        global: {
          branches: 50,
          functions: 50,
          lines: 50,
          statements: 50,
        },
      },
    },
    
    // 测试文件匹配模式
    include: [
      'test/**/*.{test,spec}.{js,ts}',
    ],
    
    // 排除的文件模式
    exclude: [
      'node_modules/',
      'dist/',
      '.wrangler/',
      'docs/',
    ],
  },
  
  // 路径别名配置（与 tsconfig.json 保持一致）
  resolve: {
    alias: {
      '@/': './src/',
    },
  },
}); 