import tailwindcss from '@tailwindcss/vite';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  app: {
    head: {
      // 界面文案为中文，正文为英文；lang 跟随界面
      htmlAttrs: { lang: 'zh-CN' },
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.ico' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' },
        {
          rel: 'stylesheet',
          // Google Fonts CSS2 会按 unicode-range 把 CJK 切成上百个分片，浏览器只下实际用到的片，
          // 不是全量字重整包。字体族与字重列表与设计交付文档一致。
          href: 'https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Noto+Serif+SC:wght@400;500;600&family=Noto+Sans+SC:wght@400;500&family=Archivo:wght@400;500;600&display=swap',
        },
      ],
      script: [
        {
          // 与 color-mode 的预置脚本同样的路子：首帧前就把速读/深读写到 <html>，
          // 否则深读内容会先渲染出来再被 CSS 隐藏，肉眼可见地闪一下。
          innerHTML:
            "!function(){try{var m=localStorage.getItem('meridian-reader-mode');document.documentElement.dataset.mode=m==='skim'?'skim':'deep'}catch(e){document.documentElement.dataset.mode='deep'}}()",
          tagPosition: 'head',
        },
      ],
    },
  },

  // dataValue 让 color-mode 在 <html> 上额外写 data-theme="dark|light"，
  // 令牌体系与 dark: 变体都挂在这个属性上（见 assets/css/main.css）。
  colorMode: { classSuffix: '', dataValue: 'theme', preference: 'system', fallback: 'light' },
  compatibilityDate: '2025-03-01',
  css: ['~/assets/css/main.css'],

  devtools: { enabled: true },
  devServer: { host: '0.0.0.0' },

  modules: ['@nuxtjs/color-mode', 'nuxt-auth-utils'],

  nitro: {
    preset: 'cloudflare-pages',
    prerender: { autoSubfolderIndex: false },
    cloudflare: {
      // 仅保留这一个配置即可启用 Node.js 兼容性
      nodeCompat: true,
      
      // wrangler 配置（可选，但建议保留）
      wrangler: {
        compatibility_date: '2025-04-30',
        compatibility_flags: ['nodejs_compat'],
        minify: false
      }
    }
  },

  // ⚠️ 只在生产开缓存。dev 下开着的话，任何数据改动（回填、重跑管线）都要等一小时
  // 才在页面上可见——SSR 已经渲染出新值，客户端水合时却拿浏览器缓存里的旧响应覆盖掉，
  // 表现成「库里明明有、页面就是不显示」，极难当场归因。
  $production: {
    routeRules: {
    // Cache the list of briefs for 1 hour on CDN, 15 mins in browser
    // Allow serving stale data for up to a day while revalidating
      '/api/briefs': {
        cache: {
          maxAge: 60 * 15, // 15 minutes browser cache
          staleMaxAge: 60 * 60 * 24, // 1 day stale-while-revalidate on CDN
        },
      },
    // Cache individual briefs for longer (assuming they don't change once published)
    // Cache for 1 day on CDN, 1 hour in browser
      '/api/briefs/**': {
        // Matches /api/briefs/some-slug, /api/briefs/another-slug etc.
        cache: {
          maxAge: 60 * 60, // 1 hour browser cache
          staleMaxAge: 60 * 60 * 24 * 7, // 1 week stale-while-revalidate on CDN
        },
      },
    },
  },

  // In production, these are set via the environment variables
  // NUXT_+{key}
  runtimeConfig: {
    database: { url: process.env.DATABASE_URL, }, // NUXT_DATABASE_URL
    mailerlite: { api_key: process.env.MAILERLITE_API_KEY || 'your_mailerlite_key', group_id: process.env.MAILERLITE_GROUP_ID || 'your_group_id' }, // NUXT_MAILERLITE_API_KEY, NUXT_MAILERLITE_GROUP_ID
    admin: { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'changeme' }, // NUXT_ADMIN_USERNAME, NUXT_ADMIN_PASSWORD
    worker: { api_token: process.env.WORKER_API_TOKEN || 'localtest' }, // NUXT_WORKER_API_TOKEN
    session: { password: process.env.SESSION_PASSWORD || 'dev_only_session_password_change_me' }, // NUXT_SESSION_PASSWORD

    // IMPORTANT: all "public" config is exposed to the client
    public: { WORKER_API: process.env.NUXT_PUBLIC_WORKER_API || 'http://localhost:8787' }, // NUXT_PUBLIC_WORKER_API
  },

  srcDir: 'src',

  vite: { plugins: [tailwindcss()] },
});
