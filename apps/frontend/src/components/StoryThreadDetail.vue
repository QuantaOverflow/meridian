<script setup lang="ts">
import type { StoryThreadDetail } from '~/shared/types';

const props = defineProps<{ thread: StoryThreadDetail }>();

/** 导语取最近一条已进简报的记录，存疑条目不能代表线索现状 */
const lead = computed(() => props.thread.entries.find(entry => !entry.disputed && entry.description !== '')?.description ?? '');

const statusLine = computed(() => {
  const parts = ['事件追踪', `持续 ${props.thread.durationDays} 天`];
  if (props.thread.escalating) parts.push('升级中');
  else if (props.thread.status === 'dormant') parts.push('暂无更新');
  return parts.join(' · ');
});

/** 最新一条的节点用强调色，其余用分隔线色 */
const latestEntryId = computed(() => props.thread.entries[0]?.id ?? null);
</script>

<template>
  <div class="mx-auto max-w-[700px] px-5 pt-[70px] pb-[140px] md:px-8">
    <NuxtLink to="/stories" class="text-ink3 hover:text-ink mb-[22px] inline-block text-[13px] transition-colors">
      ← 全部追踪
    </NuxtLink>

    <p class="mb-4 text-[12.5px] tracking-[0.1em] text-ink3">{{ statusLine }}</p>

    <h1 class="font-serif text-[28px] leading-[1.26] font-semibold tracking-[-0.01em] text-ink md:text-[42px] mb-[18px]">
      {{ thread.title }}
    </h1>

    <p v-if="lead" class="font-serif text-[18px] leading-[1.9] tracking-[0.01em] text-ink md:text-[20.5px] mb-[22px]">
      {{ lead }}
    </p>

    <p class="border-rule-soft mb-11 border-b pb-7 text-[13px] text-ink3">
      首次出现 {{ thread.firstSeenCN }} · 最近更新 {{ thread.lastSeenCN }} · {{ thread.entryCount }} 条记录 ·
      {{ thread.briefCount }} 期简报
    </p>

    <ol>
      <li
        v-for="(entry, index) in thread.entries"
        :key="entry.id"
        class="border-rule-soft relative ml-[5px] grid grid-cols-[46px_1fr] gap-4 border-l pl-6 md:grid-cols-[58px_1fr] md:gap-5"
        :class="index === thread.entries.length - 1 ? 'border-transparent pb-0' : 'pb-[34px]'"
      >
        <span
          class="absolute top-2 -left-1 h-[7px] w-[7px] rounded-full"
          :class="entry.id === latestEntryId ? 'bg-accent' : 'bg-rule'"
          aria-hidden="true"
        />

        <time class="pt-[6px] text-[12.5px] text-ink3">{{ entry.dateShortCN }}</time>

        <!-- 存疑条目：当天识别出来但没进简报。整块套引文块样式，标题降级 -->
        <div v-if="entry.disputed" class="bg-quote border-rule border-l-2 px-5 py-4">
          <h3 class="font-serif text-[17px] leading-[1.45] font-medium text-ink2 md:text-[19px] mb-2">
            {{ entry.title }}
          </h3>
          <p v-if="entry.description" class="font-serif text-[16px] leading-[1.82] tracking-[0.01em] text-ink2 mb-2">
            {{ entry.description }}
          </p>
          <!-- 只写「未进入简报」读者会以为是被删掉或不可信的内容。
               说清楚它其实是当天识别出来、但没被选进简报的候选故事。 -->
          <p class="text-[12.5px] leading-[1.6] text-ink3">未进入简报 · 当天识别出的候选，未入选当期</p>
        </div>

        <div v-else>
          <h3 class="font-serif text-[19px] leading-[1.42] font-semibold text-ink md:text-[22px] mb-[9px]">
            {{ entry.title }}
          </h3>
          <p
            v-if="entry.description"
            class="font-serif text-[16px] leading-[1.85] tracking-[0.01em] text-ink2 md:text-[18px] mb-[9px]"
          >
            {{ entry.description }}
          </p>
          <NuxtLink :to="`/briefs/${entry.briefSlug}`" class="border-rule text-ink3 hover:text-ink border-b text-[12.5px] transition-colors">
            第 {{ entry.briefNumber }} 期
          </NuxtLink>
        </div>
      </li>
    </ol>
  </div>
</template>
