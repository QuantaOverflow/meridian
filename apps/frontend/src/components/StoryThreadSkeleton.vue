<template>
  <div class="mx-auto max-w-[700px] px-5 pt-[70px] pb-[140px] md:px-8" aria-busy="true" aria-live="polite">
    <span class="sr-only">正在加载线索</span>
    <div class="bg-rule-soft mb-4 h-[13px] w-[120px] animate-pulse" />
    <div class="bg-rule-soft mb-3 h-[38px] w-full animate-pulse" />
    <div class="bg-rule-soft mb-[22px] h-[38px] w-2/3 animate-pulse" />
    <div class="bg-rule-soft mb-11 h-[18px] w-3/4 animate-pulse" />
    <div v-for="n in 3" :key="n" class="border-rule-soft ml-[5px] grid grid-cols-[58px_1fr] gap-5 border-l pb-[34px] pl-6">
      <div class="bg-rule-soft mt-2 h-[12px] w-[46px] animate-pulse" />
      <div>
        <div class="bg-rule-soft mb-[9px] h-[22px] w-4/5 animate-pulse" />
        <div class="bg-rule-soft h-[16px] w-full animate-pulse" />
      </div>
    </div>
  </div>
</template>
