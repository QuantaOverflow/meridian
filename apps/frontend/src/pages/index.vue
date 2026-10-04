<script setup lang="ts">
import type { BriefMap, BriefMapCountryCoverage, BriefTier, MapTopic } from '@meridian/contracts';
import type { GlobeTip } from '~/components/HoloGlobe.client.vue';
import { COUNTRIES, TOPIC_NAMES, countryName, leadSentences, place } from '~/lib/briefMap';
import type { GlobeDot, GlobeLink } from '~/lib/holoGlobe';
import type { BriefDetail } from '~/shared/types';

// 首页 = 最新一期的地图。先拿最新一期（顶部文案与各块导语都从这里来），再按它的期号取地图数据，
// 两份必然是同一期。顶部与右侧面板在服务端渲染，地球在浏览器里懒加载。
definePageMeta({ layout: 'holo' });

const { data, error } = await useAsyncData('home-map', async () => {
  const brief = await $fetch<BriefDetail>('/api/briefs/latest');
  // 地图数据取不到时仍给出顶部与阅读入口，不让整页挂掉
  const map = await $fetch<BriefMap>(`/api/briefs/${brief.id}/map`).catch((err: unknown) => {
    console.error('Failed to load brief map', err);
    return null;
  });
  return { brief, map };
});

if (error.value || !data.value) {
  throw createError({ statusCode: 500, statusMessage: 'Failed to load the brief', fatal: true });
}

const brief = computed(() => data.value?.brief ?? null);
useBriefSeo(brief);

const slug = computed(() => brief.value?.slug ?? '');
const SECTION: Record<BriefTier, string> = { lead: 'Top stories', more: 'More news', brief: 'In brief' };

// ── 数据：故事落点、按国家聚合 ───────────────────────────────
const events = computed(() => {
  const leads = new Map(brief.value?.sections.flatMap(s => s.stories).map(s => [s.id, leadSentences(s.leadHtml)]));
  return (data.value?.map?.events ?? []).map(e => {
    const anchor = `story-${e.blockIndex + 1}`;
    return { ...e, ...place(e.places), anchor, lead: leads.get(anchor) ?? '' };
  });
});
type HomeEvent = (typeof events.value)[number];

const byCountry = computed(() => {
  const out = new Map<string, { events: HomeEvent[]; top: boolean }>();
  for (const e of events.value) {
    if (!e.primary) continue;
    const a = out.get(e.primary) ?? { events: [], top: false };
    a.events.push(e);
    a.top ||= e.tier === 'lead';
    out.set(e.primary, a);
  }
  return out;
});

const coverage = computed(
  () => new Map<string, BriefMapCountryCoverage>((data.value?.map?.coverage.byCountry ?? []).map(c => [c.country, c]))
);
// 底色按当天文章数取对数，最多的国家为 1
const heatMap = computed(() => {
  const max = Math.max(1, ...[...coverage.value.values()].map(c => c.count));
  return new Map([...coverage.value.values()].map(c => [c.country, Math.log1p(c.count) / Math.log1p(max)]));
});

const topStories = computed(() => events.value.filter(e => e.tier === 'lead'));
const firstRest = computed(() => events.value.find(e => e.tier !== 'lead'));
const topicTags = computed(() =>
  (Object.keys(TOPIC_NAMES) as MapTopic[])
    .map(t => ({ key: t, name: TOPIC_NAMES[t], count: events.value.filter(e => e.topics.includes(t)).length }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count)
);

// ── 交互状态 ────────────────────────────────────────────────
const locked = ref<string | null>(null);
const hovered = ref<string | null>(null);
const topic = ref<MapTopic | null>(null);
const showHeat = ref(true);
const showLinks = ref(false);

function lock(key: string | null) {
  locked.value = key;
}
function setTopic(t: MapTopic | null) {
  topic.value = topic.value === t ? null : t;
  if (topic.value) locked.value = null;
}
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') locked.value = null;
}
onMounted(() => window.addEventListener('keydown', onEsc));
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc));

// ── 给地球的场景 ─────────────────────────────────────────────
const dots = computed<GlobeDot[]>(() =>
  [...byCountry.value].map(([key, a]) => ({
    key,
    r: 3 + 3.2 * Math.sqrt(a.events.length),
    pulse: a.top,
    label: `${countryName(key)} ${a.events.length}`,
    fade: !!topic.value && !a.events.some(e => e.topics.includes(topic.value!)),
  }))
);
const links = computed<GlobeLink[]>(() => {
  const out: GlobeLink[] = [];
  const focus = (keys: string[]) => !!locked.value && keys.includes(locked.value);
  for (const e of events.value) {
    if (e.primary && e.secondary) {
      const f = focus([e.primary, e.secondary]);
      if (showLinks.value || f) out.push({ a: e.primary, b: e.secondary, kind: 'second', focus: f });
    }
    const f = focus(e.spread);
    if (showLinks.value || f) {
      e.spread.forEach((a, i) => e.spread.slice(i + 1).forEach(b => out.push({ a, b, kind: 'spread', focus: f })));
    }
  }
  return out;
});
const shaded = computed(() => (showHeat.value ? heatMap.value : null));
const stats = computed(() => ({
  briefed: events.value.length,
  reports: data.value?.map?.coverage.total ?? 0,
  nations: byCountry.value.size,
}));

function tipFor(key: string): GlobeTip {
  const list = byCountry.value.get(key)?.events ?? [];
  const cov = coverage.value.get(key);
  const topicN = new Map<MapTopic, number>();
  for (const e of list) for (const t of e.topics) topicN.set(t, (topicN.get(t) ?? 0) + 1);
  return {
    title: countryName(key),
    topics: [...topicN].sort((a, b) => b[1] - a[1]).map(([t]) => ({ name: TOPIC_NAMES[t], on: topic.value === t })),
    titles: list.slice(0, 3).map(e => e.title),
    more: list.length > 3 ? `${list.length - 3} more` : null,
    loose:
      !list.length && cov?.otherTopics.length
        ? `These articles are about: ${cov.otherTopics.map(([t, n]) => `${TOPIC_NAMES[t]} ${n}`).join(' · ')}`
        : null,
    footer: [list.length ? `${list.length} in the brief` : 'No story here', `${cov?.count ?? 0} articles that day`].join(' · '),
  };
}

// ── 右侧面板 ────────────────────────────────────────────────
const where = (e: HomeEvent) => [e.primary, e.secondary].filter((k): k is string => !!k).map(countryName).join(' · ');
const alsoInvolves = (e: HomeEvent) =>
  [e.secondary, ...e.spread].filter((k): k is string => !!k && k !== locked.value).map(countryName).join(', ');
const topicEvents = computed(() => (topic.value ? events.value.filter(e => e.topics.includes(topic.value!)) : []));

const lockedView = computed(() => {
  const key = locked.value;
  if (!key) return null;
  const cov = coverage.value.get(key);
  const others = (cov?.others ?? []).map(o => ({ ...o, url: /^https?:\/\//.test(o.url) ? o.url : undefined }));
  return {
    name: countryName(key),
    main: byCountry.value.get(key)?.events ?? [],
    related: events.value.filter(e => e.primary !== key && (e.secondary === key || e.spread.includes(key))),
    count: cov?.count ?? 0,
    othersHead: others.slice(0, 6),
    othersRest: others.slice(6),
    otherTopics: (cov?.otherTopics ?? []).map(([t, n]) => `${TOPIC_NAMES[t]} ${n}`).join(' · '),
  };
});
</script>

<template>
  <section v-if="brief" class="hero">
    <div class="eyebrow">Daily Intelligence Brief · No. {{ brief.id }} · {{ brief.dateLabel }}</div>
    <p v-if="brief.tldrProse" class="tldr">{{ brief.tldrProse }}</p>
    <div class="cta-row">
      <NuxtLink class="cta" :to="`/briefs/${slug}`">Read today’s brief →</NuxtLink>
      <span class="cta-meta">{{ brief.storyCount }} stories · {{ brief.readingMinutes }} min read</span>
      <NuxtLink class="cta-alt" to="/briefs">Past briefs</NuxtLink>
    </div>
  </section>

  <template v-if="data?.map">
    <div class="bar">
      <label class="check"><input v-model="showHeat" type="checkbox"> <span>Coverage heat</span></label>
      <label class="check"><input v-model="showLinks" type="checkbox"> <span>Cross-border links</span></label>
      <span class="hint">Drag to rotate · Scroll to zoom · Click a country to lock · Esc to clear</span>
    </div>

    <div class="main">
      <div>
        <div class="globe-slot">
          <LazyHoloGlobe
            v-model:locked="locked"
            v-model:hovered="hovered"
            :dots="dots"
            :links="links"
            :shaded="shaded"
            :tip="tipFor"
            :stats="stats"
          />
        </div>
        <div class="legend">
          <span><i class="lg-active" />Story in today’s brief</span>
          <span><i class="lg-esc" />Has a top story (pulsing)</span>
          <span v-if="showHeat"><i class="lg-heat" />Shading = articles per country that day (log scale)</span>
          <span>Dot size = number of stories</span>
        </div>
      </div>

      <aside class="panel" aria-live="polite">
        <!-- 锁定一个国家 -->
        <template v-if="lockedView">
          <div>
            <div class="eyebrow">Locked</div>
            <div class="p-title">
              <h2>{{ lockedView.name }}</h2>
              <button type="button" class="linkish" @click="lock(null)">Back to all of today</button>
            </div>
            <div class="p-sub">
              {{ lockedView.main.length ? `${lockedView.main.length} in the brief` : 'No story mainly happened here' }}
              · {{ lockedView.count }} articles that day
            </div>
          </div>
          <div v-for="group in [
            { list: lockedView.main, title: 'In today’s brief', note: null },
            { list: lockedView.related, title: `Also involving ${lockedView.name}`, note: `Mainly elsewhere, but 15% or more of the coverage is from ${lockedView.name}.` },
          ].filter(g => g.list.length)" :key="group.title" class="sec">
            <h4>{{ group.title }}</h4>
            <p v-if="group.note" class="note">{{ group.note }}</p>
            <div v-for="e in group.list" :key="e.storyId" class="event">
              <div class="chips">
                <span class="chip" :class="e.tier === 'lead' ? 'esc' : 'act'">{{ SECTION[e.tier] }}</span>
                <span v-if="e.thread" class="chip">Tracking · issue {{ e.thread.briefCount }}</span>
              </div>
              <h3>{{ e.title }}</h3>
              <p>{{ e.lead }}</p>
              <div class="links">
                <NuxtLink :to="`/briefs/${slug}#${e.anchor}`">Read it in the brief →</NuxtLink>
                <NuxtLink v-if="e.thread" :to="`/stories/${e.thread.id}`">Follow the whole story ({{ e.thread.durationDays }} days) →</NuxtLink>
                <span v-if="alsoInvolves(e)">Also involves {{ alsoInvolves(e) }}</span>
              </div>
            </div>
          </div>
          <div v-if="!lockedView.main.length && !lockedView.related.length" class="empty">
            No clustered coverage from {{ lockedView.name }} today.
          </div>
          <div v-if="lockedView.othersHead.length" class="sec">
            <h4>Other articles that day · {{ lockedView.othersHead.length + lockedView.othersRest.length }}</h4>
            <p class="note">
              These did not cluster with other coverage; only one or two articles reported each.
              <template v-if="lockedView.otherTopics">Topics: {{ lockedView.otherTopics }}</template>
            </p>
            <ul class="others">
              <li v-for="o in lockedView.othersHead" :key="o.title + o.url">
                <a :href="o.url" target="_blank" rel="noopener">{{ o.title }}</a><span class="src">{{ o.source }}</span>
              </li>
            </ul>
            <details v-if="lockedView.othersRest.length" class="more">
              <summary>Show {{ lockedView.othersRest.length }} more</summary>
              <ul class="others">
                <li v-for="o in lockedView.othersRest" :key="o.title + o.url">
                  <a :href="o.url" target="_blank" rel="noopener">{{ o.title }}</a><span class="src">{{ o.source }}</span>
                </li>
              </ul>
            </details>
          </div>
        </template>

        <template v-else>
          <!-- 按主题筛选 / 默认：今天的头条 -->
          <div v-if="topic">
            <div class="eyebrow">Topic</div>
            <div class="p-title">
              <h2>{{ TOPIC_NAMES[topic] }}</h2>
              <button type="button" class="linkish" @click="setTopic(null)">All topics</button>
            </div>
            <div class="p-sub">
              {{ topicEvents.length }} today · in {{ new Set(topicEvents.map(e => e.primary).filter(Boolean)).size }} countries;
              only those stay lit on the globe
            </div>
          </div>
          <div v-else class="eyebrow">Top stories today</div>

          <div class="hcards">
            <div
              v-for="e in topic ? topicEvents : topStories"
              :key="e.storyId"
              class="hcard"
              :class="{ hover: !!e.primary && e.primary === hovered }"
              tabindex="0"
              @click="!($event.target as HTMLElement).closest('a') && e.primary && lock(e.primary)"
              @keydown.enter.self="e.primary && lock(e.primary)"
              @mouseenter="hovered = e.primary"
              @mouseleave="hovered = null"
            >
              <div class="hmeta">
                <span>{{ where(e) }}{{ topic ? ` · ${SECTION[e.tier]}` : '' }}</span>
                <NuxtLink v-if="e.thread" class="chip" :to="`/stories/${e.thread.id}`">Tracking · issue {{ e.thread.briefCount }}</NuxtLink>
              </div>
              <h3>{{ e.title }}</h3>
              <p>{{ e.lead }}</p>
              <NuxtLink :to="`/briefs/${slug}#${e.anchor}`">Read this part →</NuxtLink>
            </div>
          </div>

          <NuxtLink v-if="!topic && firstRest" class="rest" :to="`/briefs/${slug}#${firstRest.anchor}`">
            {{ events.length - topStories.length }} more in the brief →
          </NuxtLink>

          <div class="sec">
            <h4>Browse by topic</h4>
            <div class="cchips">
              <button
                v-for="t in topicTags"
                :key="t.key"
                type="button"
                class="tchip"
                :data-topic="t.key"
                :aria-pressed="topic === t.key"
                @click="setTopic(t.key)"
              >
                {{ t.name }} <b>{{ t.count }}</b>
              </button>
            </div>
          </div>
        </template>
      </aside>
    </div>
  </template>
</template>

<style scoped>
.hero { display: flex; flex-direction: column; gap: 14px; padding-block: 8px 4px; }
.eyebrow { font-size: 12px; color: var(--ink3); text-transform: uppercase; letter-spacing: 0.14em; }
.hero .eyebrow { font-size: 12.5px; }
.hero .tldr { font: 400 15px/1.75 var(--mono); margin: 0; max-width: 62ch; color: var(--ink2); }
.cta-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; }
.cta { display: inline-flex; align-items: center; gap: 10px; background: rgba(255, 179, 71, 0.12); color: var(--lock); border: 1px solid var(--lock); letter-spacing: 0.08em; padding: 11px 18px; font: 500 15px/1 var(--mono); border-radius: 3px; }
.cta:hover { background: rgba(255, 179, 71, 0.22); }
.cta-meta { color: var(--ink3); font-size: 13px; font-variant-numeric: tabular-nums; }
.cta-alt { color: var(--ink2); font-size: 13px; }

.bar { display: flex; flex-wrap: wrap; gap: 10px 20px; align-items: center; font-size: 12.5px; border-top: 1px solid var(--rule); padding-top: 12px; }
.check { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; color: var(--ink2); }
.check input { accent-color: var(--lock); }
.hint { color: var(--ink3); font-size: 12px; margin-left: auto; }

.main { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 24px; align-items: start; }
@media (max-width: 860px) { .main { grid-template-columns: 1fr; } .hint { margin-left: 0; } }

/* 地球加载前先占住位置，免得文字跳动 */
.globe-slot { position: relative; aspect-ratio: 1 / 1; max-height: 78vh; width: 100%; }
@media (max-width: 860px) { .globe-slot { max-height: 92vw; } }

.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; color: var(--ink3); margin-top: 10px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
.lg-active { background: var(--mk); }
.lg-heat { width: 18px !important; height: 10px !important; border-radius: 1px !important; background: linear-gradient(90deg, transparent, var(--heat)); opacity: 0.8; }
.lg-esc { border: 1.5px solid var(--lock); box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--lock); }

.panel { border: 1px solid var(--rule); border-top: 2px solid var(--coast); padding: 14px; background: var(--panel); display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.p-title { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.p-title h2 { font: 600 18px/1.2 var(--mono); letter-spacing: 0.12em; color: var(--lock); margin: 2px 0 0; }
.p-sub { color: var(--ink2); font-size: 13px; font-variant-numeric: tabular-nums; }
.linkish { background: none; border: 0; padding: 0; color: var(--ink3); cursor: pointer; font: inherit; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }

.chips { display: flex; gap: 6px; }
.chip { font-size: 11px; padding: 1px 6px; border: 1px solid var(--rule); color: var(--ink3); border-radius: 2px; letter-spacing: 0.04em; }
.chip.esc { border-color: var(--lock); color: var(--lock); }
.chip.act { border-color: var(--ink2); color: var(--ink); }

.hcards { display: flex; flex-direction: column; }
.hcard { padding: 12px 0 14px; border-bottom: 1px solid var(--rule); cursor: pointer; }
.hcard:first-child { padding-top: 2px; }
.hcard:hover h3, .hcard.hover h3 { color: var(--accent); }
.hcard .hmeta { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--ink3); }
.hcard h3 { font: 500 15px/1.45 var(--mono); margin: 5px 0 6px; text-wrap: balance; }
.hcard p, .event p { color: var(--ink2); font-size: 14px; line-height: 1.55; margin: 0 0 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.hcard > a, .links a { font-size: 13px; color: var(--accent); }
.hcard > a:hover, .links a:hover { text-decoration: underline; }
.rest { align-self: flex-start; font-size: 14px; color: var(--ink); border-bottom: 1px solid var(--ink3); padding-bottom: 2px; }
.rest:hover { color: var(--accent); border-color: var(--accent); }

.sec h4 { margin: 0 0 4px; font: 500 13px/1.4 var(--mono); color: var(--ink2); text-transform: uppercase; letter-spacing: 0.14em; }
.sec .note { font-size: 12.5px; color: var(--ink3); margin: 0 0 6px; }
.empty { color: var(--ink3); font-size: 14px; padding: 8px 0; }
.cchips { display: flex; flex-wrap: wrap; gap: 6px; }
.tchip { border: 1px solid var(--rule); background: none; padding: 5px 11px; font: inherit; font-size: 13.5px; cursor: pointer; border-radius: 2px; color: var(--ink); }
.tchip b { font-weight: 500; color: var(--ink3); font-variant-numeric: tabular-nums; margin-left: 3px; }
.tchip:hover, .tchip[aria-pressed='true'] { border-color: var(--probe); color: var(--probe); }

.event { padding: 12px 0; border-bottom: 1px solid var(--rule); }
.event:first-of-type { padding-top: 4px; }
.event h3 { font: 500 14px/1.45 var(--mono); margin: 4px 0; text-wrap: balance; }
.links { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; font-size: 12.5px; }
.links span { color: var(--ink3); }
.others { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.others li { padding: 6px 0; border-bottom: 1px solid var(--rule-soft); font-size: 13.5px; line-height: 1.4; }
.others a:hover { color: var(--accent); }
.others .src { color: var(--ink3); font-size: 12px; margin-left: 6px; }
.more { font-size: 13px; }
.more summary { cursor: pointer; color: var(--ink3); padding: 6px 0; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
