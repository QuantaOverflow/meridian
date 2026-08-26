export type ReaderMode = 'skim' | 'deep';

const STORAGE_KEY = 'meridian-reader-mode';

/**
 * 速读 / 深读的全局状态。
 *
 * 真正决定内容可见性的是 <html data-mode>（由 nuxt.config 的预置脚本在首帧前写入，
 * 见 assets/css/main.css 的 [data-mode='skim'] .deep-only 规则）。这里的 ref 只驱动
 * 分段控件的选中态，所以调用方需要把控件包在 <ClientOnly> 里，避免服务端渲染出
 * 默认值再被客户端改写。
 */
export function useReaderMode() {
  const mode = useState<ReaderMode>('reader-mode', () => 'deep');

  onMounted(() => {
    const applied = document.documentElement.dataset.mode;
    if (applied === 'skim' || applied === 'deep') mode.value = applied;
  });

  function setMode(next: ReaderMode) {
    mode.value = next;
    if (import.meta.client) {
      document.documentElement.dataset.mode = next;
      // 只碰自己的 key，不清其他条目
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // 隐私模式下 localStorage 会抛，模式本身仍然生效，只是不持久化
      }
    }
  }

  return { mode, setMode };
}
