import type { BriefDetail } from '~/shared/types';

/**
 * 简报页的 SEO 元数据，首页与 /briefs/:slug 共用。
 *
 * 两个路由渲染同一期内容，所以规范地址统一指向 /briefs/:slug。origin 取自请求本身，
 * 不写死域名（原代码写死了上游作者的 news.iliane.xyz）。
 */
export function useBriefSeo(brief: Ref<BriefDetail | null | undefined>) {
  const config = useRuntimeConfig();
  const origin = useRequestURL().origin;

  const summary = computed(() =>
    brief.value ? (brief.value.tldrProse ?? `${brief.value.dateCN}的每日情报简报`) : '每日情报简报'
  );

  useSeoMeta({
    title: () => (brief.value ? `${brief.value.title} | Meridian` : 'Meridian'),
    description: () => summary.value,
    ogTitle: () => brief.value?.title ?? 'Meridian',
    ogDescription: () => summary.value,
    ogUrl: () => (brief.value ? `${origin}/briefs/${brief.value.slug}` : origin),
    ogImage: () =>
      brief.value
        ? `${config.public.WORKER_API}/openGraph/brief?title=${encodeURIComponent(brief.value.title)}&date=${encodeURIComponent(new Date(brief.value.createdAt).getTime())}&articles=${brief.value.usedArticles}&sources=${brief.value.usedSources}`
        : `${config.public.WORKER_API}/openGraph/default`,
    ogLocale: 'zh_CN',
    twitterCard: 'summary_large_image',
  });

  useHead({
    link: computed(() =>
      brief.value ? [{ rel: 'canonical', href: `${origin}/briefs/${brief.value.slug}` }] : []
    ),
  });
}
