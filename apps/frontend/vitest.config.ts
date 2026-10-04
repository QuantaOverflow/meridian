import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 单元测试直接 import src 里的模块时，`~/` 照 Nuxt 的 srcDir 解析
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
    // e2e：每个文件先构建再起一个 Node 服务（@nuxt/test-utils），构建约一分钟
    testTimeout: 60_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
