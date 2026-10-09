import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 单元测试直接 import src 里的模块时，`~/` 照 Nuxt 的 srcDir 解析
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
    // e2e：先构建一次（test/built-site.ts），每个文件各起一个 Node 服务（@nuxt/test-utils）
    globalSetup: ['test/built-site.ts'],
    testTimeout: 60_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
