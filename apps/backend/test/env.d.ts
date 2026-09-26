// 测试里 `import { env } from 'cloudflare:workers'` 的类型是 Cloudflare.Env（绑定取 worker-configuration.d.ts，测试绑定见 wrangler.test.jsonc），
// 这里只补测试专用的绑定
declare namespace Cloudflare {
  interface Env {
    /** vitest.config.mts 接上了本机测试库（BACKEND_TEST_DATABASE_URL）时为 '1' */
    BACKEND_TEST_DB?: string;
  }
}
