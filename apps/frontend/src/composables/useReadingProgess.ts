function throttle<T extends (...args: any[]) => any>(func: T, wait: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const throttled = (...args: Parameters<T>) => {
    lastArgs = args;

    if (!timeout) {
      func(...args);
      timeout = setTimeout(() => {
        if (lastArgs) func(...lastArgs);
        timeout = null;
        lastArgs = null;
      }, wait);
    }
  };

  throttled.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
      lastArgs = null;
    }
  };

  return throttled;
}

export function useReadingProgress() {
  const readingProgress = ref(0);
  let scrollListener: () => void;

  const calculateProgress = () => {
    const scrollTop = document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    readingProgress.value = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
  };

  const throttledCalculateProgress = throttle(calculateProgress, 25);

  onMounted(() => {
    scrollListener = throttledCalculateProgress;
    window.addEventListener('scroll', scrollListener, { passive: true });
    calculateProgress(); // Initial calculation
  });

  onUnmounted(() => {
    window.removeEventListener('scroll', scrollListener);
    throttledCalculateProgress.cancel();
  });

  return {
    readingProgress,
  };
}
