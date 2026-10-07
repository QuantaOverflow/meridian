<script setup lang="ts">
definePageMeta({
  layout: false,
  middleware() {
    if (useUserSession().loggedIn.value === true) {
      return navigateTo('/admin');
    }
  },
});

const errorMessage = ref('');

async function login(event: Event) {
  const form = event.target as HTMLFormElement;
  const formData = new FormData(form);
  try {
    await $fetch('/api/admin/login', {
      method: 'POST',
      body: {
        username: formData.get('username') as string,
        password: formData.get('password') as string,
      },
    });
    await navigateTo('/admin', { external: true });
  } catch (error) {
    errorMessage.value = 'Invalid username or password';
  }
}
</script>

<template>
  <div>
    <EnvBanner />
    <div class="flex flex-col items-center justify-center h-screen py-12">
      <form @submit.prevent="login" class="flex flex-col justify-center gap-4 items-center border p-4">
        <input type="text" name="username" placeholder="username" class="border border-black p-1" />
        <input type="password" name="password" placeholder="password" class="border border-black p-1" />
        <p v-if="errorMessage" class="text-red-500">{{ errorMessage }}</p>
        <button type="submit" class="bg-black text-white w-full py-px">Login</button>
      </form>
    </div>
  </div>
</template>
