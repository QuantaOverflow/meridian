// 后台接口统一在这里要求登录：/api/admin/ 下除登录本身外，没有会话一律 401。
// 挡在一处而不是逐个 handler 加，是为了让以后新增的后台接口默认就在门后面（test/admin-api-auth.test.ts 按文件树逐条验）。
export default defineEventHandler(async event => {
  const path = getRequestURL(event).pathname;
  if (!path.startsWith('/api/admin/') || path === '/api/admin/login') return;
  await requireUserSession(event);
});
