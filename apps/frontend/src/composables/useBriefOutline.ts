import { HEADER_HEIGHT } from '~/utils/scroll';

/**
 * 侧栏目录的滚动高亮：把「最靠上的可见事件条目」设为激活项。
 *
 * 观察窗压到视口顶部 45% 这一带（底部 -55%），避免长条目滚过大半屏时高亮还停在
 * 上一条。自己维护可见集合而不是只看回调里的 entries——entries 只含**发生变化**的
 * 元素，光看它会在快速滚动时漏掉仍然可见的条目，高亮就卡住不动了。
 */
export function useBriefOutline(ids: Ref<string[]>) {
  const activeId = ref<string | null>(null);
  const visible = new Set<string>();
  let observer: IntersectionObserver | null = null;

  function pickActive() {
    const first = ids.value.find(id => visible.has(id));
    if (first !== undefined) {
      activeId.value = first;
      return;
    }

    // 观察带里一条都没有——最常见的是停在页首，简报头部把顶部那一带占满了。
    // 此时按位置兜底取「最后一条已经滚过去的」，都没滚过就取第一条，
    // 否则高亮会一直停在上一次的位置不动。
    const line = HEADER_HEIGHT + 8;
    let fallback = ids.value[0] ?? null;
    for (const id of ids.value) {
      const el = document.getElementById(id);
      if (el !== null && el.getBoundingClientRect().top <= line) fallback = id;
    }
    activeId.value = fallback;
  }

  function setup() {
    observer?.disconnect();
    visible.clear();
    if (typeof IntersectionObserver === 'undefined') return;

    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        pickActive();
      },
      { rootMargin: `-${HEADER_HEIGHT + 8}px 0px -55% 0px`, threshold: 0 }
    );

    for (const id of ids.value) {
      const el = document.getElementById(id);
      if (el !== null) observer.observe(el);
    }
    activeId.value = ids.value[0] ?? null;
  }

  onMounted(() => nextTick(setup));
  onUnmounted(() => observer?.disconnect());
  watch(ids, () => nextTick(setup));

  function goTo(id: string) {
    activeId.value = id;
    scrollToAnchor(id);
  }

  return { activeId, goTo };
}
