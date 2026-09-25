import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// 要读写数据库的测试（源暂停/恢复）连本机测试库，见 test/README.md「数据库」。
// 不设时 HYPERDRIVE 仍是 wrangler.test.jsonc 里的占位串，那些测试会直接报缺库，不静默跳过。
const TEST_DB = process.env.BACKEND_TEST_DATABASE_URL;
// 测试会 TRUNCATE sources：只许连本机库，防止误指到生产
if (TEST_DB && !/@(localhost|127\.0\.0\.1)[:/]/.test(TEST_DB)) {
  throw new Error(`BACKEND_TEST_DATABASE_URL 必须是本机库，拒绝: ${TEST_DB.replace(/:[^:@]*@/, ':***@')}`);
}

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
          compatibilityFlags: ["nodejs_compat"],
          ...(TEST_DB && { hyperdrives: { HYPERDRIVE: TEST_DB }, bindings: { BACKEND_TEST_DB: "1" } }),
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