<template>
  <!-- 骨架屏而不是转圈：正文列的形状先占住，落位时不跳版 -->
  <div class="mx-auto max-w-[1160px] px-5 md:px-8" aria-busy="true" aria-live="polite">
    <div class="mx-auto max-w-[668px] pt-[70px] pb-[140px]">
      <span class="sr-only">正在加载简报</span>
      <div class="bg-rule-soft mb-4 h-[13px] w-[160px] animate-pulse" />
      <div class="bg-rule-soft mb-3 h-[40px] w-full animate-pulse" />
      <div class="bg-rule-soft mb-[42px] h-[40px] w-3/4 animate-pulse" />
      <div v-for="n in 3" :key="n" class="bg-rule-soft mb-4 h-[19px] animate-pulse" :class="n === 3 ? 'w-2/3' : 'w-full'" />
    </div>
  </div>
</template>
