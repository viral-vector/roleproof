<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { LocalAnalyzeResponse } from '@roleproof/shared';

import { deleteHistoryItem, getHistoryItem } from '../../api/client.js';
import AnalysisResults from '../../components/AnalysisResults.vue';

const route = useRoute();
const router = useRouter();
const response = ref<LocalAnalyzeResponse | null>(null);
const error = ref('');
const running = ref(false);
const deleting = ref(false);

const id = typeof route.params.id === 'string' ? route.params.id : '';

async function load() {
  running.value = true;
  error.value = '';
  try {
    const envelope = await getHistoryItem(id);
    response.value = envelope;
  } catch (cause) {
    response.value = null;
    error.value = cause instanceof Error ? cause.message : 'History is unavailable.';
  } finally {
    running.value = false;
  }
}

async function remove() {
  deleting.value = true;
  error.value = '';
  try {
    await deleteHistoryItem(id);
    await router.push('/history');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'History could not be deleted.';
  } finally {
    deleting.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <main class="shell">
    <nav class="detail-nav" aria-label="History navigation">
      <RouterLink class="export-button" to="/history">&larr; Back to history</RouterLink>
      <button
        v-if="response"
        class="danger-button"
        type="button"
        :disabled="deleting"
        @click="remove"
      >
        {{ deleting ? 'Deleting...' : 'Delete this report' }}
      </button>
    </nav>

    <p v-if="response" class="fieldset-note">
      Deleting removes this report and any job description only it references. The stored résumé
      text remains available for future analyses.
    </p>

    <p v-if="error" class="error" role="alert">
      {{ error }}
      <RouterLink v-if="error.includes('not found')" to="/history">
        Analysis was not found; return to history.
      </RouterLink>
    </p>

    <p v-if="running" class="loading-note" role="status">Loading stored report...</p>

    <AnalysisResults v-if="response" :response="response" />
  </main>
</template>
