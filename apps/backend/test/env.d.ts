import type { Env } from "../src/index";

declare module "cloudflare:test" {
  // ProvidedEnv 控制 import("cloudflare:test").env 的类型
  // 继承从项目定义的 Env 接口
  interface ProvidedEnv extends Env {
    // 测试专用的额外绑定
    TEST_NAMESPACE?: KVNamespace;
    TEST_ARTICLES_BUCKET?: R2Bucket;
  }
} 