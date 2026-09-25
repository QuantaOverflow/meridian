// cloudflare:test 的 env 类型：绑定取 worker-configuration.d.ts 的全局 Env（测试绑定见 wrangler.test.jsonc）
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
