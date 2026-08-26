<script setup lang="ts">
defineProps<{
  items: { id: string; title: string }[];
  activeId: string | null;
}>();

const emit = defineEmits<{ (e: 'navigate', id: string): void }>();
</script>

<template>
  <nav aria-label="本期事件目录">
    <p class="mb-[14px] text-[11.5px] tracking-[0.12em] text-ink3">本期 {{ items.length }} 条</p>

    <ul class="border-rule-soft flex flex-col gap-[2px] border-l">
      <li v-for="item in items" :key="item.id">
        <button
          type="button"
          :aria-current="activeId === item.id ? 'true' : undefined"
          :class="
            activeId === item.id
              ? 'text-ink shadow-[inset_2px_0_0_var(--text)]'
              : 'text-ink3 hover:text-ink'
          "
          class="w-full cursor-pointer py-[6px] pl-[14px] text-left text-[13px] leading-[1.45] transition-colors"
          @click="emit('navigate', item.id)"
        >
          <!-- 标题里可能带 markdown 行内标记，解析时已渲染成 HTML -->
          <span v-html="item.title" />
        </button>
      </li>
    </ul>
  </nav>
</template>
