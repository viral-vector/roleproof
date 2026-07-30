<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterLink } from 'vue-router';

import ProofMark from './ProofMark.vue';
import StatusPill from './StatusPill.vue';
import { useHealthStore } from '../stores/health.js';

const health = useHealthStore();

onMounted(() => {
  void health.refresh();
});
</script>

<template>
  <div class="app-header-wrap">
    <header class="app-header">
      <RouterLink class="brand" to="/" aria-label="RoleProof home">
        <ProofMark class="brand-mark" />
        <span class="brand-copy">
          <strong>RoleProof</strong>
          <small>Local workspace</small>
        </span>
      </RouterLink>
      <nav class="primary-nav" aria-label="Primary navigation">
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/analyze">Analyze</RouterLink>
        <RouterLink to="/history">History</RouterLink>
        <RouterLink to="/settings">Settings</RouterLink>
      </nav>
      <StatusPill :state="health.status" />
    </header>
  </div>

  <slot />
</template>
