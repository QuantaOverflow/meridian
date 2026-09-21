<script setup lang="ts">
interface OutlineItem {
  id: string;
  title: string;
}
interface OutlineGroup {
  id: string;
  heading: string;
  items: OutlineItem[];
}

const props = defineProps<{
  groups: OutlineGroup[];
  activeId: string | null;
}>();

const emit = defineEmits<{ (e: 'navigate', id: string): void }>();

const total = computed(() => props.groups.reduce((n, group) => n + group.items.length, 0));
</script>

<template>
  <nav aria-label="本期事件目录">
    <p class="mb-[14px] text-[11.5px] tracking-[0.12em] text-ink3">本期 {{ total }} 条</p>

    <!-- 分组之间留白比组内大一档，让三节一眼分得开；组内仍靠左侧那条竖线串起来 -->
    <div class="flex flex-col gap-[18px]">
      <section v-for="group in groups" :key="group.id">
        <!-- 板块名沿用正文里的原文（小写是本简报的 house style，见 displayTitle） -->
        <h2 class="mb-[6px] pl-[14px] text-[10.5px] tracking-[0.14em] text-ink3 uppercase">
          {{ group.heading }}
        </h2>

        <ul class="border-rule-soft flex flex-col gap-[2px] border-l">
          <li v-for="item in group.items" :key="item.id">
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
      </section>
    </div>
  </nav>
</template>
