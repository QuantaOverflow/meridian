<script setup lang="ts">
import type { BriefDetail } from '~/shared/types';

const props = defineProps<{ brief: BriefDetail }>();

/**
 * 目录按板块分组——分组信息正文里本来就有（`## top stories` / `## more news` / `## in brief`
 * 三节是按重要性分的，正文也是分节渲染的），此前目录把它拍平了，25 条挤成一列没有主次。
 * 不另起主题分类：那是个不存在的新维度，要额外的分类步，还会盖掉「源数 × 篇数」的排序。
 *
 * noteworthy 那类没有事件条目的板块不进目录。
 */
const outlineGroups = computed(() =>
  props.brief.sections
    .map(section => ({
      id: section.id,
      heading: section.heading,
      items: section.stories.map(story => ({ id: story.id, title: story.title })),
    }))
    .filter(group => group.items.length > 0)
);
/** 滚动高亮要的是**扁平**的条目序——观察器按文档顺序挑「最靠上的可见项」 */
const outlineIds = computed(() => outlineGroups.value.flatMap(group => group.items.map(item => item.id)));
const { activeId, goTo } = useBriefOutline(outlineIds);

const VISIBLE_SOURCE_COUNT = 8;
const visibleSources = computed(() => props.brief.sources.slice(0, VISIBLE_SOURCE_COUNT));
const hiddenSourceCount = computed(() => Math.max(0, props.brief.sources.length - VISIBLE_SOURCE_COUNT));
const showAllArticles = ref(false);
</script>

<template>
  <div class="relative mx-auto max-w-[1160px] px-5 md:px-8">
    <!-- bottom-0 必须留着：sticky 子元素只能在父元素的盒子里滑动，而这个 aside 是绝对
         定位的，不给下边界它的高度就只等于目录本身，滚过一屏目录就跟着消失了 -->
    <aside class="toc:block absolute top-[74px] bottom-0 left-0 hidden w-[186px]">
      <div class="sticky top-[106px]">
        <BriefOutline :groups="outlineGroups" :active-id="activeId" @navigate="goTo" />
      </div>
    </aside>

    <!-- 正文列在视口正中，侧栏是绝对定位浮在左侧留白里的，不占文档流也就不会把正文推偏 -->
    <div class="mx-auto max-w-[668px] pt-[70px] pb-[140px]">
      <header>
        <p class="mb-4 text-[12.5px] tracking-[0.1em] text-ink3">每日情报简报 · 第 {{ brief.id }} 期</p>

        <h1
          class="font-serif text-[28px] leading-[1.24] font-semibold tracking-[-0.01em] text-ink md:text-[44px] mb-[18px]"
        >
          {{ brief.title }}
        </h1>

        <div
          class="border-rule-soft mb-[42px] flex flex-wrap gap-[11px] border-b pb-5 text-[13.5px] text-ink3"
        >
          <span>{{ brief.dateCN }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ brief.storyCount }} 条事件</span>
          <span aria-hidden="true">·</span>
          <span>{{ brief.readingMinutes }} 分钟阅读</span>
        </div>

        <p
          v-if="brief.tldrProse"
          class="font-serif text-[19px] leading-[1.9] tracking-[0.01em] text-ink md:text-[21px] mb-[52px]"
        >
          {{ brief.tldrProse }}
        </p>
      </header>

      <section v-for="section in brief.sections" :key="section.id" :id="section.id">
        <div v-if="section.heading" class="mb-[30px] flex items-center gap-[14px]">
          <!-- 设计稿写的是 white-space: nowrap（假设板块名是「地缘 · 中东」这种短中文），
               但真实板块名由模型按当天内容自命名、常是一整句英文，nowrap 会横向撑破视口。
               允许换行后短标题表现不变，长标题的延伸横线落在末行旁边，仍是设计的形态。 -->
          <h2 class="font-sans text-[16px] font-semibold tracking-[0.02em] text-ink" v-html="section.heading" />
          <span class="bg-rule h-px flex-1" aria-hidden="true" />
        </div>

        <div v-if="section.leadHtml" class="brief-prose mb-[58px]" v-html="section.leadHtml" />

        <article
          v-for="story in section.stories"
          :key="story.id"
          :id="story.id"
          :class="story.headline ? 'mb-[62px]' : 'mb-[58px]'"
        >
          <h3
            :class="
              story.headline
                ? 'text-[24px] md:text-[30px] leading-[1.36] tracking-[-0.005em] mb-4'
                : 'text-[21px] md:text-[25px] leading-[1.40] mb-[14px]'
            "
            class="font-serif font-semibold text-ink"
            v-html="story.title"
          />

          <div class="brief-prose" v-html="story.leadHtml" />
          <!-- 第二段起属于深读；速读模式由 [data-mode='skim'] .deep-only 隐藏 -->
          <div v-if="story.restHtml" class="brief-prose deep-only mt-6" v-html="story.restHtml" />
        </article>
      </section>

      <div v-if="brief.sources.length > 0" class="deep-only border-rule-soft mb-[44px] border-t pt-[28px]">
        <div class="flex flex-wrap items-center gap-[10px] text-[13px] text-ink3">
          <span>来源</span>
          <span v-for="source in visibleSources" :key="source.name" class="border-rule border-b">
            {{ source.name }}
          </span>
          <span v-if="hiddenSourceCount > 0">+{{ hiddenSourceCount }}</span>
          <span class="flex-1" />
          <button
            type="button"
            class="text-accent cursor-pointer"
            :aria-expanded="showAllArticles"
            @click="showAllArticles = !showAllArticles"
          >
            {{ showAllArticles ? '收起原文' : `查看全部 ${brief.sourceArticleCount} 篇原文 →` }}
          </button>
        </div>

        <div v-if="showAllArticles" class="mt-7 flex flex-col gap-6">
          <div v-for="source in brief.sources" :key="source.name">
            <p class="mb-2 text-[12.5px] tracking-[0.1em] text-ink3">
              {{ source.name }} · {{ source.articles.length }}
            </p>
            <ul class="flex flex-col gap-[6px]">
              <li v-for="article in source.articles" :key="article.url" class="text-[14px] leading-[1.6]">
                <NuxtLink
                  :to="article.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="border-rule text-ink2 hover:text-ink border-b transition-colors"
                >
                  {{ article.title }}
                </NuxtLink>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
