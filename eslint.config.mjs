// 只开一条带类型的规则：no-floating-promises（三个 Worker 的 src 与测试）。
// 为什么只这一条：Workers 里没 await、也没交给 ctx.waitUntil / step.do 的 promise，请求结束后会被取消，
// 失败还不会报错——典型是日志/R2 写入静默丢失；测试里漏 await 的断言则会假绿。
// 别的风格问题交给 prettier 与 tsc。由 .githooks/pre-push 跑（`pnpm lint`），与 knip、ruff 并列。
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const rule = {
  plugins: { '@typescript-eslint': tseslint.plugin },
  linterOptions: { reportUnusedDisableDirectives: 'error' },
  rules: { '@typescript-eslint/no-floating-promises': 'error' },
};

export default defineConfig(
  {
    ...rule,
    files: [
      'apps/backend/src/**/*.ts',
      'apps/backend/test/**/*.ts',
      'services/meridian-ai-worker/src/**/*.ts',
      'services/meridian-ml-service/cf-worker/src/**/*.ts',
    ],
    // 每个文件用离它最近的 tsconfig.json（backend 的含 worker-configuration.d.ts），类型与 tsc 一致
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // LLM 调用必须经 callLLM → loggedChat 才会挂进 span、落 R2 的 llm-calls/；直接用底层 chat() 或
    // env.AI.run 调用照样成功、只是悄悄不记。只有 llm-call-logger.ts 能碰底层（workers-ai.ts 自己实现它）。
    files: ['services/meridian-ai-worker/src/**/*.ts', 'apps/backend/src/**/*.ts'],
    ignores: ['services/meridian-ai-worker/src/services/llm-call-logger.ts', 'services/meridian-ai-worker/src/services/workers-ai.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/workers-ai'],
          importNames: ['chat'],
          message: '直接调 chat() 不记 LLM 日志：改走 callLLM（services/call-llm.ts）。确需绕开（如 eval 透传口）就加 eslint-disable 注释写明原因。',
        }],
      }],
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.property.name='run'][callee.object.property.name='AI']",
        message: '直接调 env.AI.run 不记 LLM 日志：改走 callLLM（services/call-llm.ts）。',
      }],
    },
  },
  {
    ...rule,
    // ai-worker 的测试由 tsconfig.test.json 覆盖，projectService 只认 tsconfig.json，这里显式指定
    files: ['services/meridian-ai-worker/test/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './services/meridian-ai-worker/tsconfig.test.json', tsconfigRootDir: import.meta.dirname },
    },
  },
);
