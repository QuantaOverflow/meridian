import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'miniflare',
    environmentOptions: {
      // Miniflare options for Cloudflare Workers environment
      modules: true,
      scriptPath: './src/index.ts',
    },
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*'
      ]
    }
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})
