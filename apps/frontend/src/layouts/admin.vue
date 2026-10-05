<script lang="ts" setup>
if (useUserSession().loggedIn.value === false) {
  await navigateTo('/admin/login');
}

// 运维台的五个视图；Run detail 从 Health 的运行表点进去，不占页签
const tabs = [
  { to: '/admin', label: 'Health' },
  { to: '/admin/trends', label: 'Trends' },
  { to: '/admin/cost', label: 'Cost' },
  { to: '/admin/sources', label: 'Sources' },
];
const route = useRoute();
// Health 管 /admin 本身和运行详情；其余页签按路径前缀（Sources 含单个来源页 /admin/feed/*）
function isActive(to: string) {
  if (to === '/admin') return route.path === '/admin' || route.path.startsWith('/admin/runs/');
  if (to === '/admin/sources') return route.path.startsWith('/admin/sources') || route.path.startsWith('/admin/feed/');
  return route.path.startsWith(to);
}

async function logout() {
  try {
    await useUserSession().clear();
    location.reload();
  } catch (error) {
    console.error(error);
    alert('Failed to log out');
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 p-4">
    <div class="flex flex-wrap justify-between items-center gap-x-6 gap-y-2 mb-4 border-b pb-2">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
        <NuxtLink to="/admin">
          <h1 class="text-lg font-medium text-gray-800">Meridian Ops</h1>
        </NuxtLink>
        <nav class="flex gap-4 text-sm" aria-label="Ops console">
          <NuxtLink
            v-for="tab in tabs"
            :key="tab.to"
            :to="tab.to"
            :aria-current="isActive(tab.to) ? 'page' : undefined"
            :class="isActive(tab.to) ? 'text-gray-900 font-medium underline underline-offset-4' : 'text-gray-600 hover:text-gray-900'"
          >
            {{ tab.label }}
          </NuxtLink>
        </nav>
      </div>
      <button
        @click="logout"
        class="text-sm text-gray-600 hover:cursor-pointer hover:text-gray-900 border px-2 py-0.5 rounded"
      >
        Log out
      </button>
    </div>
    <slot />
  </div>
</template>
