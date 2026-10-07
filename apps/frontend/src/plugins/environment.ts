// 非生产环境的每个页面（含错误页）都声明不让搜索引擎收录；生产环境不加任何东西。
export default defineNuxtPlugin(() => {
  if (useRuntimeConfig().public.ENVIRONMENT !== 'production') {
    useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] });
  }
});
