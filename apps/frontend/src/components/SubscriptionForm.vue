<script setup lang="ts">
const COOKIE_NAME = 'meridian_subscribed';
const LEGACY_STORAGE_KEY = 'meridian_subscribed';

// Subscription state
const email = ref('');
const isSubmitting = ref(false);
const errorMessage = ref('');
const hasSubscribed = useCookie<string | null>(COOKIE_NAME);

// Migrate old localStorage data if it exists
onMounted(() => {
  const legacyValue = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacyValue === 'true' && !hasSubscribed.value) {
    hasSubscribed.value = 'true';
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
});

/**
 * Subscription form handlers
 */
const handleSubmit = async () => {
  isSubmitting.value = true;
  errorMessage.value = '';

  try {
    const response = await $fetch('/api/subscribe', {
      method: 'POST',
      body: { email: email.value },
    });

    if (!response.success) {
      throw new Error(response.message || 'Failed to subscribe');
    }

    email.value = '';
    hasSubscribed.value = 'true';
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '出了点问题，请再试一次。';
    console.error('Subscription error:', error);
  } finally {
    isSubmitting.value = false;
  }
};

const handleChangeEmail = () => {
  hasSubscribed.value = null;
  errorMessage.value = '';
};
</script>

<template>
  <section id="subscribe" class="border-rule-soft border-t pt-[34px]">
    <ClientOnly>
      <div v-if="!hasSubscribed">
        <!-- 简报由 cron "0 13 * * *"（UTC）触发，即北京时间每晚 21:00 -->
        <h4 class="font-serif text-[21px] font-semibold text-ink mb-2">每晚 9 点，同样一封</h4>
        <p class="mb-4 text-[14px] leading-[1.7] text-ink2">邮件版和这里读到的内容完全一致。</p>

        <form class="flex max-w-[390px] gap-2" @submit.prevent="handleSubmit">
          <input
            id="subscribe-email"
            v-model="email"
            type="email"
            placeholder="your@email.com"
            required
            :aria-invalid="errorMessage !== ''"
            aria-describedby="subscription-error"
            aria-label="邮箱地址"
            class="border-rule text-ink placeholder:text-ink3 flex-1 rounded-full border bg-transparent px-[15px] py-[11px] text-[13.5px]"
          />
          <button
            type="submit"
            class="bg-accent cursor-pointer rounded-full px-[22px] py-[11px] text-[13.5px] whitespace-nowrap text-white disabled:opacity-60"
            :disabled="isSubmitting"
          >
            {{ isSubmitting ? '提交中…' : '订阅' }}
          </button>
        </form>

        <p v-if="errorMessage" id="subscription-error" class="mt-3 text-[13px] text-accent" role="alert">
          {{ errorMessage }}
        </p>
      </div>

      <div v-else>
        <h4 class="font-serif text-[21px] font-semibold text-ink mb-2">已订阅</h4>
        <p class="mb-4 text-[14px] leading-[1.7] text-ink2">下一封会准时到。</p>
        <button
          type="button"
          class="border-rule text-ink2 hover:border-ink hover:text-ink cursor-pointer rounded-full border px-[22px] py-[10px] text-[13.5px] transition-colors"
          @click="handleChangeEmail"
        >
          换个邮箱
        </button>
      </div>

      <template #fallback>
        <div class="h-[150px]" />
      </template>
    </ClientOnly>
  </section>
</template>
