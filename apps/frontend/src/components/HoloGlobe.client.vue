<script lang="ts" setup>
/**
 * 地图首页的地球（只在浏览器里渲染，页面用 <LazyHoloGlobe> 懒加载）。
 *
 * 对页面的接口就这些（类型在 lib/globeScene.ts）：进来的是点、连线、国家底色（含主题筛选的淡出）与锁定 / 悬停的国家，
 * 出去的是锁定与悬停的变化（v-model:locked / v-model:hovered）。绘制、拾取、旋转、缩放、悬停提示的定位、
 * HUD 与皮肤都在这个组件和 lib/holoGlobe.ts 里，将来换 three.js 渲染器只换这两处。
 */
import type { Topology } from 'topojson-specification';
import { COUNTRIES } from '~/lib/briefMap';
import type { GlobeDot, GlobeLink, GlobeTip } from '~/lib/globeScene';
import type { HoloGlobe } from '~/lib/holoGlobe';

const props = defineProps<{
  dots: GlobeDot[];
  links: GlobeLink[];
  shaded: Map<string, number> | null;
  tip: (key: string) => GlobeTip;
  stats: { briefed: number; reports: number; nations: number };
}>();
const locked = defineModel<string | null>('locked', { required: true });
const hovered = defineModel<string | null>('hovered', { required: true });

const stage = ref<HTMLElement>();
const canvas = ref<HTMLCanvasElement>();
const tipEl = ref<HTMLElement>();
const tipAt = ref<{ key: string; x: number; y: number } | null>(null);
const tipPos = ref({ left: 0, top: 0 });
let globe: HoloGlobe | null = null;

const tipContent = computed(() => (tipAt.value ? props.tip(tipAt.value.key) : null));

// 提示框贴着指针、不出 stage 右缘与上缘；要等内容渲染出来才知道尺寸
watch(tipAt, async at => {
  if (!at) return;
  await nextTick();
  const w = tipEl.value?.offsetWidth ?? 0;
  const h = tipEl.value?.offsetHeight ?? 0;
  const W = stage.value?.clientWidth ?? 0;
  tipPos.value = { left: Math.max(4, Math.min(W - w - 4, at.x + 14)), top: Math.max(4, at.y - h - 10) };
});

onMounted(async () => {
  // d3、topojson 与底图只在这里按需加载，SSR 与首屏文字都不等它
  const [{ createHoloGlobe }, atlas] = await Promise.all([
    import('~/lib/holoGlobe'),
    import('world-atlas/countries-110m.json'),
  ]);
  if (!stage.value || !canvas.value) return; // 加载期间已卸载
  globe = createHoloGlobe({
    stage: stage.value,
    canvas: canvas.value,
    countries: COUNTRIES,
    world: (atlas.default ?? atlas) as unknown as Topology,
    onHover(key, x, y) {
      hovered.value = key;
      tipAt.value = key ? { key, x, y } : null;
    },
    onLock(key) {
      locked.value = key;
    },
  });
  globe.setScene({ dots: props.dots, links: props.links, shaded: props.shaded });
  globe.setLocked(locked.value);
  globe.setHover(hovered.value);
});

onBeforeUnmount(() => globe?.destroy());

watch(
  () => [props.dots, props.links, props.shaded] as const,
  ([dots, links, shaded]) => globe?.setScene({ dots, links, shaded })
);
watch(locked, key => globe?.setLocked(key));
watch(hovered, key => {
  globe?.setHover(key);
  if (tipAt.value && tipAt.value.key !== key) tipAt.value = null; // 悬停改由面板卡片驱动时收起提示
});

const target = computed(() => {
  const key = locked.value ?? hovered.value;
  return key ? { key, country: COUNTRIES[key] } : null;
});
</script>

<template>
  <div ref="stage" class="stage">
    <canvas ref="canvas" aria-label="Globe of today’s brief. Drag to rotate." />
    <div class="hud tl">
      <div class="hud-title">Meridian · Holo terminal</div>
      <div class="row"><span>Briefed</span><b>{{ stats.briefed }}</b></div>
      <div class="row"><span>Reports</span><b>{{ stats.reports }}</b></div>
      <div class="row"><span>Nations</span><b>{{ stats.nations }}</b></div>
    </div>
    <div class="hud bl">
      <div>Selected region</div>
      <div class="hud-target">— {{ target ? (target.country?.name ?? target.key) : 'No target' }} —</div>
      <div class="row"><span>Lat</span><b>{{ target?.country ? target.country.lat.toFixed(2) : '--.--' }}</b></div>
      <div class="row"><span>Lon</span><b>{{ target?.country ? target.country.lon.toFixed(2) : '--.--' }}</b></div>
      <div class="row"><span>Status</span><b>{{ locked ? 'Locked' : hovered ? 'Probing' : 'Idle' }}</b></div>
    </div>
    <div class="zoom">
      <button type="button" aria-label="Zoom in" @click="globe?.zoomBy(1.35)">+</button>
      <button type="button" aria-label="Zoom out" @click="globe?.zoomBy(1 / 1.35)">−</button>
    </div>
    <div
      v-if="tipContent"
      ref="tipEl"
      class="tip"
      :style="{ left: `${tipPos.left}px`, top: `${tipPos.top}px` }"
    >
      <strong>{{ tipContent.title }}</strong>
      <div v-if="tipContent.topics.length" class="ttopics">
        <i v-for="t in tipContent.topics" :key="t.name" class="ttopic" :class="{ on: t.on }">{{ t.name }}</i>
      </div>
      <ul v-if="tipContent.titles.length" class="ttitles">
        <li v-for="title in tipContent.titles" :key="title">{{ title }}</li>
        <li v-if="tipContent.more" class="tmore">{{ tipContent.more }}</li>
      </ul>
      <div v-if="tipContent.loose" class="tloose">{{ tipContent.loose }}</div>
      <span>{{ tipContent.footer }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 填满页面给的框（页面先占好位置，地球加载前后不跳） */
.stage { position: absolute; inset: 0; touch-action: none; user-select: none; }
.stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; }
.stage canvas.dragging { cursor: grabbing; }
.stage canvas.pointing { cursor: pointer; }

.zoom { position: absolute; right: 6px; bottom: 6px; display: flex; flex-direction: column; border: 1px solid var(--rule); border-radius: 4px; background: var(--bg); overflow: hidden; }
.zoom button { width: 32px; height: 32px; border: 0; background: none; cursor: pointer; font-size: 17px; color: var(--ink); }
.zoom button + button { border-top: 1px solid var(--rule); }

.hud { position: absolute; font: 11px/1.5 var(--mono); color: var(--ink2); letter-spacing: 0.12em; text-transform: uppercase; pointer-events: none; border: 1px solid var(--rule); padding: 8px 10px; background: rgba(4, 12, 18, 0.7); }
.hud b { color: var(--ink); font-weight: 500; }
.hud.tl { left: 4px; top: 4px; }
.hud.bl { left: 4px; bottom: 4px; min-width: 180px; }
.hud .row { display: flex; justify-content: space-between; gap: 18px; }
.hud-title { color: var(--ink); letter-spacing: 0.3em; margin-bottom: 6px; }
.hud-target { color: var(--lock); font-size: 14px; margin: 4px 0; }

.tip { position: absolute; pointer-events: none; background: var(--bg); border: 1px solid var(--border); padding: 7px 10px; font-size: 13px; line-height: 1.4; max-width: 320px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12); z-index: 3; }
.tip strong { font-family: var(--mono); font-size: 15px; display: block; }
.tip span { color: var(--ink2); font-variant-numeric: tabular-nums; }
.tip .ttopics { display: flex; flex-wrap: wrap; gap: 4px; margin: 5px 0 4px; }
.tip .ttopic { font-style: normal; font-size: 12px; padding: 1px 6px; border: 1px solid var(--rule); color: var(--ink2); border-radius: 2px; }
.tip .ttopic.on { border-color: var(--lock); color: var(--lock); }
.tip .ttitles { list-style: none; margin: 4px 0 5px; padding: 0; display: flex; flex-direction: column; gap: 3px; font: 12px/1.45 var(--mono); color: var(--ink); }
.tip .ttitles li::before { content: '· '; color: var(--ink3); }
.tip .ttitles .tmore { color: var(--ink3); }
.tip .ttitles .tmore::before { content: ''; }
.tip .tloose { margin: 4px 0 5px; color: var(--ink); font-size: 13px; }
</style>
