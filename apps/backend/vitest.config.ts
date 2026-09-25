import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    fileParallelism: false,
    poolOptions: {
      workers: {
        isolatedStorage: false,  // 工作流测试需要设置为 false
        // 所有测试文件共用一个 Worker。不开的话每个文件各起一个 Worker，第二个文件一进来
        // workerd 就以 `inserted row already exists in table` 起不来（实测：两个 spec 各自单跑
        // 都绿，一起跑 0 测试、退出码 1）——也就是说关着它这个包只能有一个测试文件。
        singleWorker: true,
        wrangler: { 
          configPath: "./wrangler.test.jsonc" 
        },
        miniflare: {
          // 兼容性设置
          compatibilityDate: "2025-04-17",
          compatibilityFlags: ["nodejs_compat"]
        },
      },
    },
    
    // 测试超时
    testTimeout: 30000,
    
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
}); 