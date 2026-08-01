<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import type { LocalHistoryItem } from '@roleproof/shared';

import { deleteHistoryItem, listHistory } from '../../api/client.js';

const items = ref<LocalHistoryItem[]>([]);
const search = ref('');
const running = ref(false);
const error = ref('');
const removedId = ref<string | null>(null);

const searching = computed(() => search.value.trim().length > 0);

function formatLabel(value: string) {
  return value.replaceAll('-', ' ');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatJobId(jobId: string) {
  return jobId.length <= 42 ? jobId : `${jobId.slice(0, 20)}...${jobId.slice(-10)}`;
}

async function load() {
  running.value = true;
  error.value = '';
  try {
    const response = await listHistory(search.value);
    items.value = response.history;
  } catch (cause) {
    items.value = [];
    error.value = cause instanceof Error ? cause.message : 'History is unavailable.';
  } finally {
    running.value = false;
  }
}

async function removeItem(id: string) {
  removedId.value = id;
  error.value = '';
  try {
    await deleteHistoryItem(id);
    items.value = items.value.filter((item) => item.id !== id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'History could not be deleted.';
  } finally {
    removedId.value = null;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <main class="shell">
    <section class="workspace" aria-labelledby="history-title">
      <header class="section-heading">
        <div>
          <p class="section-index">Stored locally</p>
          <h2 id="history-title">Analysis history</h2>
        </div>
        <p>Reports are saved to your local database after each analysis.</p>
      </header>

      <form class="history-search" role="search" @submit.prevent="load">
        <label for="history-query">Search history</label>
        <div class="search-row">
          <input
            id="history-query"
            v-model="search"
            class="search-input"
            type="search"
            maxlength="500"
            placeholder="Skill, company, or recommendation..."
          />
          <button class="export-button" type="submit" :disabled="running">
            {{ running ? 'Searching...' : 'Search' }}
          </button>
        </div>
        <p class="search-hint">
          {{
            searching
              ? 'Matching stored reports, jobs, and recommendations.'
              : 'Leave the search empty to show every stored report.'
          }}
        </p>
      </form>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section class="history-list-wrap" aria-labelledby="history-list-title" :aria-busy="running">
      <h2 id="history-list-title" class="visually-hidden">Stored reports</h2>
      <ul v-if="items.length > 0" class="history-list">
        <li v-for="item in items" :key="item.id" class="history-row">
          <div class="history-row-main">
            <span class="classification" :data-classification="item.recommendation">
              {{ formatLabel(item.recommendation) }}
            </span>
            <div class="history-row-copy">
              <p>
                Fit score <strong>{{ item.overallScore }}/100</strong>
                <span aria-hidden="true">&middot;</span>
                {{ Math.round(item.confidence * 100) }}% confidence
              </p>
              <small>
                <time :datetime="item.generatedAt">{{ formatDate(item.generatedAt) }}</time>
                <span aria-hidden="true">&middot;</span>
                <span :title="item.jobId">{{ formatJobId(item.jobId) }}</span>
              </small>
            </div>
          </div>
          <div class="history-row-actions">
            <RouterLink class="export-button" :to="`/history/${item.id}`">Open</RouterLink>
            <button
              class="danger-button"
              type="button"
              :disabled="removedId !== null"
              @click="removeItem(item.id)"
            >
              {{ removedId === item.id ? 'Deleting...' : 'Delete' }}
            </button>
          </div>
        </li>
      </ul>
      <div v-else-if="!running" class="history-empty">
        <p>{{ searching ? 'No stored report matches this search.' : 'No stored analyses yet.' }}</p>
        <p v-if="!searching">
          <RouterLink to="/analyze">Run a comparison</RouterLink> and it will appear here.
        </p>
      </div>
    </section>
  </main>
</template>
