// Workers 在 nodejs_compat 下提供 node:async_hooks 的 AsyncLocalStorage（官方文档：只实现子集，
// 缺 enterWith() / disable()）。本包不装 @types/node——那会把 Node 的全局类型混进 Worker 代码——
// 所以只声明 services/observe.ts 用到的这几个成员。
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, fn: () => R): R;
    getStore(): T | undefined;
  }
}
