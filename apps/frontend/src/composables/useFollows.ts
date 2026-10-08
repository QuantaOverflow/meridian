import { browserStorage, followKey, readFollows, toggleFollow, writeFollows, type Follow } from '~/lib/follows';

/**
 * 关注项的页面状态。服务端渲染时没有关注项（它们只在浏览器里）：`ready` 在浏览器读过 localStorage 之后才为 true，
 * 依赖关注项的界面在那之前按「还不知道」渲染。状态放在 useState 里，各处的关注按钮与 Following 页共用一份；
 * 没有 localStorage 时它就是这次会话里的全部。
 */
export function useFollows() {
  const follows = useState<Follow[]>('follows', () => []);
  const ready = useState('follows-ready', () => false);

  onMounted(() => {
    if (ready.value) return;
    follows.value = readFollows(browserStorage());
    ready.value = true;
  });

  const isFollowing = (follow: Follow) => follows.value.some(f => followKey(f) === followKey(follow));

  function toggle(follow: Follow) {
    follows.value = toggleFollow(follows.value, follow);
    writeFollows(browserStorage(), follows.value);
  }

  return { follows, ready, isFollowing, toggle };
}
