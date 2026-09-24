<script lang="ts" setup>
definePageMeta({ layout: 'admin' });

const route = useRoute();
const sourceId = Number(route.params.id);

// state for filters and sorting
const currentPage = ref(1);
const statusFilter = ref<string>('all');
const completenessFilter = ref<string>('all');
const qualityFilter = ref<string>('all');
const sortBy = ref<string>('createdAt');
const sortOrder = ref<'asc' | 'desc'>('desc');

// 与 packages/database 的 articleStatusEnum 一致；details.get.ts 只认枚举内的值，其余等于不筛选
const statuses = [
  'PENDING_FETCH',
  'CONTENT_FETCHED',
  'PROCESSED',
  'SKIPPED_PDF',
  'SKIPPED_TOO_OLD',
  'FETCH_FAILED',
  'RENDER_FAILED',
  'AI_ANALYSIS_FAILED',
  'EMBEDDING_FAILED',
  'R2_UPLOAD_FAILED',
];
const completenessLevels = ['COMPLETE', 'PARTIAL_USEFUL', 'PARTIAL_USELESS'];
const qualityLevels = ['OK', 'LOW_QUALITY', 'JUNK'];

// fetch feed details and sample articles
const {
  data: feedDetails,
  error: feedError,
  refresh,
} = await useFetch(() => `/api/admin/sources/${sourceId}/details`, {
  query: computed(() => ({
    page: currentPage.value,
    status: statusFilter.value,
    completeness: completenessFilter.value,
    quality: qualityFilter.value,
    sortBy: sortBy.value,
    sortOrder: sortOrder.value,
  })),
});
if (feedError.value) {
  console.error(feedError.value);
  if (feedError.value.statusCode === 401) {
    await navigateTo('/admin/login');
  } else {
    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch feed details' });
  }
}

type FeedDetails = NonNullable<typeof feedDetails.value>;
type Article = NonNullable<FeedDetails['articles']>[number];

const getStatusColor = (status: Article['status']) => {
  switch (status) {
    case 'PROCESSED':
      return 'text-green-600';
    case 'PENDING_FETCH':
    case 'CONTENT_FETCHED':
      return 'text-yellow-600';
    default:
      return 'text-red-600';
  }
};

const getCompletenessColor = (completeness: Article['completeness']) => {
  switch (completeness) {
    case 'COMPLETE':
      return 'text-green-600';
    case 'PARTIAL_USEFUL':
      return 'text-yellow-600';
    case 'PARTIAL_USELESS':
      return 'text-red-600';
    default:
      return 'text-gray-600';
  }
};

const getQualityColor = (quality: Article['content_quality']) => {
  switch (quality) {
    case 'OK':
      return 'text-green-600';
    case 'LOW_QUALITY':
      return 'text-yellow-600';
    case 'JUNK':
      return 'text-red-600';
    default:
      return 'text-gray-600';
  }
};

// watch for filter/sort changes and refresh data
watch([currentPage, statusFilter, completenessFilter, qualityFilter, sortBy, sortOrder], () => {
  refresh();
});

async function initDOs() {
  await $fetch(`/api/admin/sources/${sourceId}/init-dos`, {
    method: 'POST',
  });
}

// Add delete functionality
async function deleteSource() {
  if (!confirm('Are you sure you want to delete this source? This action cannot be undone.')) {
    return;
  }

  try {
    await $fetch(`/api/admin/sources/${sourceId}`, {
      method: 'DELETE',
    });
    // Redirect back to sources list after successful deletion
    await navigateTo('/admin');
  } catch (error) {
    console.error('Failed to delete source:', error);
    alert('Failed to delete source. Please try again.');
  }
}
</script>

<template>
  <div>

    <div v-if="feedDetails" class="space-y-4">
      <!-- Source Info -->
      <div class="bg-white rounded-lg border p-4">
        <div class="flex justify-between items-start mb-3">
          <h1 class="text-xl font-medium text-gray-900">{{ feedDetails.name }}</h1>
          <div class="flex gap-2">
            <button
              v-if="feedDetails.initialized === false"
              class="border bg-red-500 px-4 py-2 rounded hover:cursor-pointer hover:bg-red-600 text-white"
              @click="initDOs"
            >
              Init DOs
            </button>
            <button
              class="border bg-red-500 px-4 py-2 rounded hover:cursor-pointer hover:bg-red-600 text-white"
              @click="deleteSource"
            >
              Delete Source
            </button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span class="text-gray-500">Source URL:</span>
            <a :href="feedDetails.url" target="_blank" class="text-blue-600 hover:underline ml-2">{{
              feedDetails.url
            }}</a>
          </div>
          <div>
            <span class="text-gray-500">Frequency:</span>
            <span class="ml-2">{{ feedDetails.frequency }}</span>
          </div>
          <div>
            <span class="text-gray-500">Last Fetched:</span>
            <span class="ml-2">{{ formatDate(feedDetails.lastFetched) }}</span>
          </div>
          <div>
            <span class="text-gray-500">Total Articles:</span>
            <span class="ml-2">{{ feedDetails.pagination.totalItems }}</span>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="bg-white rounded-lg border p-3">
        <div class="flex flex-wrap gap-3 items-center text-sm">
          <div class="flex items-center gap-2">
            <label class="text-gray-600">Status:</label>
            <select v-model="statusFilter" class="border rounded px-2 py-1 text-sm">
              <option value="all">All</option>
              <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
            </select>
          </div>

          <div class="flex items-center gap-2">
            <label class="text-gray-600">Completeness:</label>
            <select v-model="completenessFilter" class="border rounded px-2 py-1 text-sm">
              <option value="all">All</option>
              <option v-for="level in completenessLevels" :key="level" :value="level">{{ level }}</option>
            </select>
          </div>

          <div class="flex items-center gap-2">
            <label class="text-gray-600">Quality:</label>
            <select v-model="qualityFilter" class="border rounded px-2 py-1 text-sm">
              <option value="all">All</option>
              <option v-for="level in qualityLevels" :key="level" :value="level">{{ level }}</option>
            </select>
          </div>

          <div class="flex items-center gap-2">
            <label class="text-gray-600">Sort by:</label>
            <select v-model="sortBy" class="border rounded px-2 py-1 text-sm">
              <option value="publishedAt">Published Date</option>
              <option value="processedAt">Processed Date</option>
              <option value="createdAt">Created Date</option>
            </select>
            <button class="p-1 rounded hover:bg-gray-100" @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'">
              {{ sortOrder === 'asc' ? '↑' : '↓' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Articles Table -->
      <div class="bg-white rounded-lg border overflow-hidden">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr class="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th class="px-2 py-2 text-left">Title</th>
                <th class="px-2 py-2 text-left w-24">Status</th>
                <th class="px-2 py-2 text-left w-24">Complete</th>
                <th class="px-2 py-2 text-left w-20">Quality</th>
                <th class="px-2 py-2 text-left w-16">Lang</th>
                <th class="px-2 py-2 text-left w-32">Location</th>
                <th class="px-2 py-2 text-left w-32">Published</th>
                <th class="px-2 py-2 text-left w-32">Processed</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <tr v-for="article in feedDetails.articles" :key="article.id" class="hover:bg-gray-50">
                <td class="px-2 py-2">
                  <div class="flex items-center">
                    <a
                      :href="article.url"
                      target="_blank"
                      class="text-blue-600 hover:underline truncate max-w-md"
                      >{{ article.title }}</a
                    >
                    <span v-if="!article.hasEmbedding" class="ml-2 text-xs text-yellow-600">(No Embedding)</span>
                  </div>
                </td>
                <td class="px-2 py-2">
                  <div>
                    <span :class="getStatusColor(article.status)" class="text-xs">{{ article.status }}</span>
                    <div v-if="article.failReason" class="text-xs text-red-600 truncate max-w-[12rem]">
                      {{ article.failReason }}
                    </div>
                  </div>
                </td>
                <td class="px-2 py-2">
                  <span :class="getCompletenessColor(article.completeness)" class="text-xs">{{
                    article.completeness
                  }}</span>
                </td>
                <td class="px-2 py-2">
                  <span :class="getQualityColor(article.content_quality)" class="text-xs">{{
                    article.content_quality
                  }}</span>
                </td>
                <td class="px-2 py-2 text-xs">{{ article.language }}</td>
                <td class="px-2 py-2 text-xs truncate">{{ article.primary_location || '-' }}</td>
                <td class="px-2 py-2 text-xs">{{ formatDate(article.publishedAt) }}</td>
                <td class="px-2 py-2 text-xs">{{ formatDate(article.processedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Pagination -->
      <div class="flex justify-between items-center text-sm">
        <div class="text-gray-600">
          Showing {{ (currentPage - 1) * 50 + 1 }} to
          {{ Math.min(currentPage * 50, feedDetails.pagination.totalItems) }} of
          {{ feedDetails.pagination.totalItems }} articles
        </div>
        <div class="flex gap-2">
          <button
            class="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
            :disabled="currentPage === 1"
            @click="currentPage--"
          >
            Previous
          </button>
          <button
            class="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
            :disabled="currentPage === feedDetails.pagination.totalPages"
            @click="currentPage++"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
