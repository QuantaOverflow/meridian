好的，这是一份关于如何使用 `vitest-pool-cloudflare` 进行 Cloudflare Worker 本地测试的通用使用文档，不包含您当前项目的具体代码，旨在提供一般性的指导。

---

## 使用 `vitest-pool-cloudflare` 进行 Cloudflare Worker 本地测试

`@cloudflare/vitest-pool-workers` 是 Cloudflare 官方为 Vitest 测试框架提供的一个测试池。它利用了 Miniflare（或其底层的 Workerd 运行时），在本地环境中精确模拟 Cloudflare Workers 的生产运行时行为。这允许你在本地测试你的 Worker 代码，并与 Worker 绑定资源（如 Durable Objects、R2 存储桶、Workers Queues、Workers Workflows、KV 命名空间、D1 数据库等）进行高度真实的交互，而无需将 Worker 部署到 Cloudflare 边缘。

### 1. 依赖安装

要开始使用，你需要将 `vitest` 和 `@cloudflare/vitest-pool-workers` 安装为你的项目的开发依赖：

```bash
pnpm add -D vitest @cloudflare/vitest-pool-workers
# 或者 npm install -D vitest @cloudflare/vitest-pool-workers
# 或者 yarn add -D vitest @cloudflare/vitest-pool-workers
```

**兼容性提示**: 请注意检查 `@cloudflare/vitest-pool-workers` 的文档，了解其与 Vitest 版本的具体兼容性要求。

### 2. 配置文件设置

`vitest-pool-cloudflare` 的配置主要通过 `vitest.config.ts` 文件完成，并通常与你的 `wrangler.jsonc` (或 `wrangler.toml`) 配置文件协同工作。

#### 2.1 `vitest.config.ts`

这是你的 Vitest 主配置文件。你需要导入 `defineWorkersConfig` 并配置 `test.poolOptions.workers` 字段。

```typescript
// vitest.config.ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    // 启用全局 Vitest API (describe, it, expect 等)
    globals: true,
    // 建议禁用文件并行测试，以更好地控制模拟绑定资源的隔离性
    fileParallelism: false, 
    poolOptions: {
      workers: {
        // 配置 Miniflare 的行为
        isolatedStorage: true, // 推荐：为每个测试文件提供独立的本地存储，防止数据污染
        wrangler: { 
          // 指向你的 Worker 的 Wrangler 配置文件。
          // Miniflare 会读取此文件来了解 Worker 的绑定和配置。
          configPath: "./wrangler.jsonc", // 或 "./wrangler.toml"，或你的测试专用配置路径
        },
        miniflare: {
          // 此处配置的选项会覆盖 Wrangler 配置文件中的相应设置，
          // 并允许你定义测试专用的绑定或行为。
          // 环境变量 (vars):
          bindings: {
            MY_TEST_VAR: "test_value",
            EXTERNAL_API_KEY: "mock_key_for_test",
          },
          // R2 存储桶绑定:
          // r2Buckets: ["MY_BUCKET_NAME"],
          // KV 命名空间绑定:
          // kvNamespaces: ["MY_KV_NAMESPACE"],
          // Durable Objects 绑定:
          // durableObjects: {
          //   MY_DO: "MyDurableObjectClass",
          // },
          // Workers Queues 绑定:
          // queues: ["MY_QUEUE"],
          // Workers Workflows 绑定:
          // workflows: ["MY_WORKFLOW_NAME"],
          // Service Bindings (如果你想模拟两个 Worker 间的通信):
          // serviceBindings: {
          //   MY_SERVICE: "another-worker-service-name",
          // },
          // 兼容性设置，确保与生产环境一致
          compatibilityDate: "YYYY-MM-DD",
          compatibilityFlags: ["nodejs_compat"],
        },
      },
    },
    // 其他 Vitest 配置，如超时、覆盖率等
    testTimeout: 30000,
    coverage: { /* ... */ },
    include: ['test/**/*.test.{js,ts}'],
  },
});
```

#### 2.2 `wrangler.jsonc` (或 `wrangler.toml`)

这是你的 Cloudflare Worker 的主要配置文件。`vitest-pool-cloudflare` 会读取此文件来识别你的 Worker 需要哪些绑定资源。确保所有你在 `env` 对象中期望访问的绑定（如 `R2Bucket`、`DurableObject`、`Queue`、`Workflow` 等）都在此文件中声明。

**提示**: 你可以为测试创建一个单独的 Wrangler 配置文件（例如 `wrangler.test.jsonc`），并在 `vitest.config.ts` 中通过 `configPath` 指向它，这样可以针对测试环境进行特定的绑定或变量配置。

#### 2.3 TypeScript 类型定义 (`env.d.ts` 或 `tsconfig.json`)

为了在测试文件中获得正确的类型提示，你需要确保 TypeScript 配置正确。

1.  **运行 `wrangler types`**: 这会生成 Worker 运行时环境的类型定义，包括根据你的 Wrangler 配置生成的 `Env` 接口。
2.  **在测试 `tsconfig.json` 中配置类型**: 确保你的测试目录下的 `tsconfig.json` 继承了主 `tsconfig.json`，并包含 `@cloudflare/vitest-pool-workers` 类型。
    ```json
    // test/tsconfig.json
    {
      "extends": "../tsconfig.json",
      "compilerOptions": {
        "types": [
          "@cloudflare/vitest-pool-workers", // 提供 `cloudflare:test` 模块的类型
          "vitest/globals" // 如果你使用了 Vitest 的全局 API
        ]
      },
      "include": [
        "./**/*.ts",
        "../src/worker-configuration.d.ts" // 包含 wrangler types 生成的 Env 类型文件
      ]
    }
    ```
3.  **扩展 `ProvidedEnv` 接口 (`test/env.d.ts`)**: 如果你在 `vitest.config.ts` 或 `wrangler.jsonc` 中定义了未在主 `Env` 接口中声明的测试专用绑定，你可以在 `test/env.d.ts` 中扩展 `ProvidedEnv` 接口。
    ```typescript
    // test/env.d.ts
    import type { Env } from "../src/index"; // 导入你的 Worker 的 Env 接口

    declare module "cloudflare:test" {
      interface ProvidedEnv extends Env {
        // 在这里声明你的测试专用绑定类型，例如：
        // MY_TEST_KV: KVNamespace;
        // MY_TEST_R2_BUCKET: R2Bucket;
      }
    }
    ```

### 3. 编写测试

在你的测试文件中，你可以从 `cloudflare:test` 模块导入一些有用的工具：

*   `env`: 这是 Miniflare 模拟的 Worker `env` 对象，你可以通过它访问所有配置的绑定资源。
*   `SELF`: 一个特殊的 `ServiceBinding`，用于向你正在测试的 Worker 自身发送模拟的 HTTP 请求（集成测试）。
*   `createExecutionContext()` / `waitOnExecutionContext()`: 用于单元测试 Worker 的 `fetch` 处理程序，模拟 Worker 运行时的执行上下文，并确保 `ctx.waitUntil()` 中的异步任务完成。

**示例代码片段（概念性）：**

```typescript
// test/my-worker.test.ts
import { env, SELF, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// 导入你的 Worker 模块（用于单元测试）
import worker from "../src/index"; 

describe("My Cloudflare Worker", () => {
  // 单元测试示例：直接调用 Worker 的 fetch 方法
  it("should handle basic requests", async () => {
    const request = new Request("http://example.com/hello");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx); // 等待所有异步操作完成

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello World!");
  });

  // 集成测试示例：使用 SELF 模拟对 Worker 自身的 HTTP 请求
  it("should respond to a specific path", async () => {
    const response = await SELF.fetch("http://example.com/api/data");
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("items");
  });

  // 绑定资源交互测试示例：R2 存储桶
  it("should put and get an object from R2", async () => {
    const testBucket = env.MY_BUCKET_NAME as R2Bucket; // 假设你的 R2 桶绑定名为 MY_BUCKET_NAME
    const key = "test-file.txt";
    const content = "Test content for R2.";

    await testBucket.put(key, content);
    const storedObject = await testBucket.get(key);

    expect(storedObject).toBeDefined();
    expect(await storedObject?.text()).toBe(content);
  });

  // 绑定资源交互测试示例：Durable Object
  it("should interact with a Durable Object", async () => {
    // 假设你的 DO 绑定名为 MY_DO_BINDING
    const id = env.MY_DO_BINDING.idFromName("test-do");
    const stub = env.MY_DO_BINDING.get(id);

    const response = await stub.fetch("http://do-host/increment");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1");
  });
});
```

### 4. 运行测试

在你的项目根目录的终端中运行 Vitest：

```bash
npx vitest
```

或者，如果你的 `package.json` 中定义了测试脚本（例如 `"test": "vitest"`），则运行：

```bash
npm test # 或 pnpm test
```

### 5. 关键优势

*   **高度真实的本地模拟**：`vitest-pool-cloudflare` 提供了非常接近 Cloudflare Workers 生产环境的本地运行时，减少了本地测试与实际部署行为之间的差异。
*   **绑定资源交互**：可以直接在测试中与模拟的 Durable Objects、R2 存储桶、队列、工作流、KV 命名空间等进行交互，无需依赖外部服务或复杂的 mocking。
*   **快速反馈**：在本地运行测试比部署到远程环境要快得多，有助于加速开发迭代。
*   **测试隔离**：通过 `isolatedStorage` 等选项，可以确保测试之间的数据隔离，避免副作用。

通过以上步骤，你就可以利用 `vitest-pool-cloudflare` 在本地高效、真实地测试你的 Cloudflare Worker 应用。

---

**更多信息和高级用法，请参考 Cloudflare 官方文档：**

*   [Cloudflare Docs - Vitest Integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
*   [Cloudflare Docs - Environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)
*   [Cloudflare Blog - Unit Testing Workers in Cloudflare Workers](https://blog.cloudflare.com/unit-testing-workers-in-cloudflare-workers/)