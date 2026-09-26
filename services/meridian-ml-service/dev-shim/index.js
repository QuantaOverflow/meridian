// 本地开发 / replay 专用：顶替生产的 meridian-ml-service Worker（生产那个前面挂 Container，本地没有）。
// backend 的 ML_SERVICE binding 按 Worker 名找到这里，原样转发到本机 uvicorn（ML_LOCAL_URL）。
// 零依赖；永不部署（生产部署走 ../cf-worker）。用法见 ../README.md「本地开发」。
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, env.ML_LOCAL_URL);
    return fetch(new Request(target, request));
  },
};
