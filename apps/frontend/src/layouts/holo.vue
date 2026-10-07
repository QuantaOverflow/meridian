<script lang="ts" setup>
// 地图首页专用的全息外观（深色、青色线稿、等宽字、HUD）。其余页面仍用 default 布局与 main.css 的令牌：
// 全息令牌只挂在 <html data-skin="holo"> 上，离开这个布局时 useHead 会把属性撤掉。
useHead({
  htmlAttrs: { 'data-skin': 'holo', lang: 'en' },
  link: [{ rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap' }],
});
</script>

<template>
  <div class="holo">
    <header class="mast">
      <NuxtLink to="/" class="brand">Meridian</NuxtLink>
      <nav class="nav">
        <NuxtLink to="/">Today</NuxtLink>
        <NuxtLink to="/briefs">Archive</NuxtLink>
        <NuxtLink to="/stories">Stories</NuxtLink>
        <NuxtLink to="/search">Search</NuxtLink>
      </nav>
    </header>
    <slot />
  </div>
</template>

<style>
/* 颜色只表示状态——青 = 基础，绿 = 探测中，琥珀 = 已锁定；品红只给跨国连线（和青色海岸线撞色时看不清）。html 上的属性选择器比 main.css 的 [data-theme] 更具体。
 * 地球的 canvas 也从这里取色（lib/holoGlobe.ts 的 readColors），全息配色只改这一处 */
html[data-skin='holo'] {
  color-scheme: dark;
  --bg: #04090e;
  --ink: #cdefff;
  --ink2: #86bfd6;
  --ink3: #4f8199;
  --rule: #12303f;
  --rule-soft: #0b1f2a;
  --accent: #ffb347;
  --panel: #06121a;
  --coast: #5fd4ff;
  --border: #2d8fb5;
  --mk: #5fd4ff;
  --probe: #7dffb0;
  --lock: #ffb347;
  --link: #ff6ad5;
  --heat: #5fd4ff;
  --land: rgba(70, 190, 230, 0.1);
  --land-hi: rgba(255, 179, 71, 0.22);
  --grat: rgba(95, 212, 255, 0.13);
  --mono: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
  --text: var(--ink);
}

html[data-skin='holo'] body {
  background: var(--bg);
  color: var(--ink);
}

html[data-skin='holo'] :focus-visible {
  outline-color: var(--lock);
}

.holo {
  width: 100%;
  max-width: 1240px;
  margin: 0 auto;
  padding: 20px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  font: 15px/1.55 var(--mono);
  color: var(--ink);
}

.holo .mast {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--rule);
  padding-bottom: 12px;
}

.holo .brand {
  font: 600 17px/1 var(--mono);
  letter-spacing: 0.35em;
}

.holo .nav {
  display: flex;
  gap: 18px;
  font-size: 14px;
  color: var(--ink3);
}

.holo .nav a[aria-current] {
  color: var(--ink);
  border-bottom: 2px solid var(--accent);
  padding-bottom: 3px;
}
</style>
