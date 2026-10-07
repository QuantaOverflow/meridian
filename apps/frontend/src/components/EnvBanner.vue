<script lang="ts" setup>
// 非生产环境（NUXT_PUBLIC_ENVIRONMENT 不是 production）页面顶部的醒目横幅；生产环境什么都不渲染。
// 放在 app.vue 最上面（所有页面，不分 layout）与 error.vue；不收录的 meta 在 plugins/environment.ts。
const { ENVIRONMENT } = useRuntimeConfig().public;
</script>

<template>
  <div
    v-if="ENVIRONMENT !== 'production'"
    role="status"
    style="background: #f59e0b; color: #1a1a1a; text-align: center; font: 600 13px/1 system-ui, sans-serif; letter-spacing: 0.08em; padding: 8px 12px"
  >
    STAGING · not the live site
  </div>
</template>
