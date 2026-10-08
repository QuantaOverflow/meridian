<script setup lang="ts">
import type { Follow } from '~/lib/follows';

// 关注按钮（国家页、线索页）。关注项只在浏览器里：服务端渲染出的是未关注的样子，浏览器读过存储后再更新
const props = defineProps<{ follow: Follow }>();
const { isFollowing, toggle } = useFollows();
const following = computed(() => isFollowing(props.follow));
</script>

<template>
  <button
    type="button"
    data-follow-button
    :aria-pressed="following"
    :title="following ? 'Stop following' : 'New stories will show up on your Following page'"
    :class="following ? 'bg-ink text-paper border-ink' : 'border-rule text-ink2 hover:text-ink'"
    class="cursor-pointer rounded-full border px-4 py-[6px] text-[13px] whitespace-nowrap transition-colors"
    @click="toggle(follow)"
  >
    {{ following ? 'Following' : 'Follow' }}
  </button>
</template>
