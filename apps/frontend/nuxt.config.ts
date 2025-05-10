import tailwindcss from '@tailwindcss/vite';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      link: [{ rel: 'icon', type: 'image/png', href: '/favicon.ico' }],
    },
  },

  colorMode: { classSuffix: '', preference: 'system', fallback: 'system' },
  compatibilityDate: '2025-03-01',
  css: ['~/assets/css/main.css'],

  devtools: { enabled: true },
  devServer: { host: '0.0.0.0' },

  modules: ['@nuxtjs/color-mode', 'nuxt-auth-utils'],

  nitro: {
    preset: 'cloudflare-pages',
    prerender: { autoSubfolderIndex: false },
    cloudflare: {
      nodeCompat: true,
      deployConfig: true,
      // Add flags through wrangler config
      wrangler: {
        compatibility_flags: ['nodejs_compat'],
        minify: false
      }
    }
  },

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

  // In production, these are set via the environment variables
  // NUXT_+{key}
  runtimeConfig: {
    database: { url: process.env.DATABASE_URL, }, // NUXT_DATABASE_URL
    mailerlite: { api_key: process.env.MAILERLITE_API_KEY || 'your_mailerlite_key', group_id: process.env.MAILERLITE_GROUP_ID || 'your_group_id' }, // NUXT_MAILERLITE_API_KEY, NUXT_MAILERLITE_GROUP_ID
    admin: { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || '709323' }, // NUXT_ADMIN_USERNAME, NUXT_ADMIN_PASSWORD
    worker: { api_token: process.env.WORKER_API_TOKEN || 'localtest' }, // NUXT_WORKER_API_TOKEN
    session: { password: process.env.SESSION_PASSWORD || '7f1ab0148b14456584a38b989c5fedd4' }, // NUXT_SESSION_PASSWORD

    // IMPORTANT: all "public" config is exposed to the client
    public: { WORKER_API: process.env.NUXT_PUBLIC_WORKER_API || 'http://localhost:8787' }, // NUXT_PUBLIC_WORKER_API
  },

  srcDir: 'src',

  vite: { plugins: [tailwindcss()] },
});
