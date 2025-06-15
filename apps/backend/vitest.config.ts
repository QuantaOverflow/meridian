import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    fileParallelism: false,
    poolOptions: {
      workers: {
        isolatedStorage: true,
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