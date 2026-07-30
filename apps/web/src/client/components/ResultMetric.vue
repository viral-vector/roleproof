<script setup lang="ts">
defineProps<{ label: string; value: string }>();
</script>

<template>
  <div class="metric">
    <dt>{{ label }}</dt>
    <dd>{{ value }}</dd>
  </div>
</template>
