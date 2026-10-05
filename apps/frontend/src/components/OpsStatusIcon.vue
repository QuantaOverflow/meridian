<script lang="ts" setup>
// 运维台的状态图形：形状和颜色同时区分（红方、黄三角、绿圆、灰环 = 还没发生、灰双竖 = 暂停），
// 与 Sources 页表里的图形一致。只是装饰，旁边必须有文字标签。
defineProps<{ kind: 'ok' | 'yellow' | 'red' | 'pending' | 'paused'; size?: number }>();
</script>

<template>
  <svg :width="size ?? 12" :height="size ?? 12" viewBox="0 0 12 12" aria-hidden="true" class="flex-none">
    <rect v-if="kind === 'red'" x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="#d03b3b" />
    <path v-else-if="kind === 'yellow'" d="M6 1 L11.2 10.5 H0.8 Z" fill="#fab219" stroke="#9a6b00" stroke-linejoin="round" />
    <circle v-else-if="kind === 'ok'" cx="6" cy="6" r="5" fill="#0ca30c" />
    <circle v-else-if="kind === 'pending'" cx="6" cy="6" r="4.5" fill="none" stroke="#6b6a66" stroke-width="1.6" />
    <g v-else fill="#898781">
      <rect x="2.5" y="2" width="2.5" height="8" rx="1" />
      <rect x="7" y="2" width="2.5" height="8" rx="1" />
    </g>
  </svg>
</template>
