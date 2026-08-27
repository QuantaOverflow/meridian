<script lang="ts" setup>
import { MoonIcon, SunIcon } from '@heroicons/vue/24/outline';

const route = useRoute();
const colorMode = useColorMode();
const { mode, setMode } = useReaderMode();
const { readingProgress } = useReadingProgress();

// 「今日简报」= 首页与任意一期简报详情；「归档」只认列表页本身
// 375px 视口装不下三个四字导航 + 分段控件 + 主题按钮，实测会折成两行。
// 移动端换短标签（语义不丢），md 以上恢复完整文案。
const navItems = computed(() => [
  { label: '今日简报', short: '今日', to: '/', active: route.path === '/' || route.path.startsWith('/briefs/') },
  { label: '归档', short: '归档', to: '/briefs', active: route.path === '/briefs' },
  { label: '事件追踪', short: '追踪', to: '/stories', active: route.path.startsWith('/stories') },
]);

function toggleTheme() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark';
}

// 订阅入口下线期间闲置，恢复订阅时一并放开
// function goToSubscribe() {
//   scrollToAnchor('subscribe', 40);
//   // 滚动动画期间就聚焦会被浏览器打断滚动，等落位后再聚焦
//   window.setTimeout(() => document.getElementById('subscribe-email')?.focus(), 600);
// }
</script>

<template>
  <div class="min-h-screen bg-paper">
    <!-- 路由切换时顶部走一条进度线，让「点了但还没到」这段时间可见 -->
    <NuxtLoadingIndicator color="var(--accent)" :height="2" />
    <header class="bg-paper border-rule-soft sticky top-0 z-60 border-b">
      <div class="mx-auto flex h-[58px] max-w-[1160px] items-center gap-2.5 px-5 md:gap-[22px] md:px-8">
        <NuxtLink to="/" class="font-serif text-[18px] leading-none font-semibold tracking-[-0.01em] whitespace-nowrap text-ink md:text-[22px]">
          Meridian
        </NuxtLink>

        <span class="bg-rule hidden h-[18px] w-px md:block" aria-hidden="true" />

        <nav class="flex gap-2.5 text-[12.5px] md:gap-5 md:text-[14px]">
          <NuxtLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            :aria-current="item.active ? 'page' : undefined"
            :class="item.active ? 'text-ink' : 'text-ink3 hover:text-ink'"
            class="whitespace-nowrap transition-colors"
          >
            <span class="md:hidden">{{ item.short }}</span>
            <span class="hidden md:inline">{{ item.label }}</span>
          </NuxtLink>
        </nav>

        <span class="flex-1" />

        <ClientOnly>
          <div
            role="radiogroup"
            aria-label="阅读模式"
            class="border-rule flex shrink-0 overflow-hidden rounded-full border text-[12px] md:text-[13px]"
          >
            <button
              v-for="opt in [
                { value: 'skim' as const, label: '速读' },
                { value: 'deep' as const, label: '深读' },
              ]"
              :key="opt.value"
              type="button"
              role="radio"
              :aria-checked="mode === opt.value"
              :class="mode === opt.value ? 'bg-ink text-paper' : 'text-ink3 hover:text-ink'"
              class="cursor-pointer px-2.5 py-[5px] whitespace-nowrap transition-colors md:px-[14px]"
              @click="setMode(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </ClientOnly>

        <ClientOnly>
          <button
            type="button"
            class="text-ink2 hover:text-ink flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors md:h-[30px] md:w-[30px]"
            :aria-label="colorMode.value === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
            @click="toggleTheme"
          >
            <SunIcon v-if="colorMode.value === 'dark'" class="h-[17px] w-[17px]" :stroke-width="1.5" />
            <MoonIcon v-else class="h-[17px] w-[17px]" :stroke-width="1.5" />
          </button>
        </ClientOnly>

        <!-- 订阅入口暂时下线：runtimeConfig.mailerlite 没有真实 key，
             会落回 nuxt.config.ts 里的占位符 'your_mailerlite_key'，
             读者点了只会静默失败。拿到 MailerLite key 后连同
             BriefArticle.vue 里的 <SubscriptionForm /> 一起放开。 -->
      </div>

      <div class="absolute right-0 bottom-0 left-0 h-[2px]">
        <div
          class="bg-accent h-full transition-[width] duration-100 ease-linear"
          :style="{ width: `${readingProgress}%` }"
        />
      </div>
    </header>

    <slot />

    <footer class="border-rule-soft mx-auto max-w-[1160px] border-t px-5 py-7 text-[12.5px] text-ink3 md:px-8">
      <p>
        <NuxtLink to="https://github.com/QuantaOverflow/meridian" target="_blank" rel="noopener noreferrer" class="border-rule border-b">
          在 GitHub 开源
        </NuxtLink>
      </p>
    </footer>
  </div>
</template>
