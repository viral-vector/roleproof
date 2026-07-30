<script setup lang="ts">
defineProps<{ title: string; description: string }>();
</script>

<template>
  <main class="shell">
    <section class="hero compact" aria-labelledby="placeholder-title">
      <div class="hero-copy">
        <p class="eyebrow"><span aria-hidden="true"></span> Phase 4 workspace</p>
        <h1 id="placeholder-title">{{ title }}</h1>
        <p class="hero-intro">{{ description }}</p>
        <div class="trust-row"><span>Local only</span><span>In progress</span></div>
      </div>
    </section>
  </main>
</template>
