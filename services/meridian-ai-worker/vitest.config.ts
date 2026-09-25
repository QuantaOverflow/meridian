import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // 测试全是纯函数（prompt / 解析 / 校验），不需要 Workers 运行时
    environment: 'node',
    testTimeout: 10000,
  }
})
