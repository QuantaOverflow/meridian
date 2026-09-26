import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// 要读写数据库的测试（源暂停/恢复）连本机测试库，见 test/README.md「数据库」。
// 不设时 HYPERDRIVE 仍是 wrangler.test.jsonc 里的占位串，那些测试会直接报缺库，不静默跳过。
const TEST_DB = process.env.BACKEND_TEST_DATABASE_URL;
// 测试会 TRUNCATE sources：只许连本机库，防止误指到生产
if (TEST_DB && !/@(localhost|127\.0\.0\.1)[:/]/.test(TEST_DB)) {
  throw new Error(`BACKEND_TEST_DATABASE_URL 必须是本机库，拒绝: ${TEST_DB.replace(/:[^:@]*@/, ':***@')}`);
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.test.jsonc"
      },
      miniflare: {
        // 兼容性设置
        compatibilityDate: "2025-04-17",
        compatibilityFlags: ["nodejs_compat"],
        ...(TEST_DB && { hyperdrives: { HYPERDRIVE: TEST_DB }, bindings: { BACKEND_TEST_DB: "1" } }),
      },
    }),
  ],
  test: {
    globals: true,
    // 数据库测试共用一个本机库、各自 TRUNCATE，文件之间不能并行
    fileParallelism: false,
    // vitest-pool-workers 0.13 起删了 isolatedStorage / singleWorker：存储按测试文件隔离，
    // 同一文件内各测试共享 DO 与存储（等同旧的 isolatedStorage: false）。

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