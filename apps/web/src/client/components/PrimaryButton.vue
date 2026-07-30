<script setup lang="ts">
defineProps<{ disabled?: boolean }>();
</script>

<template>
  <button class="primary-button" type="submit" :disabled="disabled">
    <slot />
    <span class="button-arrow" aria-hidden="true">&rarr;</span>
  </button>
</template>
