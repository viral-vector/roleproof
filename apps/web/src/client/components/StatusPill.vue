<script setup lang="ts">
import type { HealthState } from '../stores/health.js';

defineProps<{ state: HealthState }>();
</script>

<template>
  <span class="status" :data-state="state" aria-live="polite">
    <span class="status-dot" aria-hidden="true"></span>
    Local server: {{ state }}
  </span>
</template>
