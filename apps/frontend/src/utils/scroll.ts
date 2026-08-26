/** 顶栏高度，锚点跳转必须扣掉它，否则目标会被压在栏下面 */
export const HEADER_HEIGHT = 58;

/**
 * 平滑滚动到锚点。
 *
 * 刻意不用 element.scrollIntoView()：它把目标顶到视口最上沿，无法扣掉 sticky
 * 顶栏，而 scroll-margin-top 又会和这里的余量重复计算。自己算偏移最可控。
 */
export function scrollToAnchor(id: string, gap = 24) {
  const el = document.getElementById(id);
  if (el === null) return;

  const top = el.getBoundingClientRect().top + window.scrollY - HEADER_HEIGHT - gap;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}
