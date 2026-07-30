<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <main class="shell landing-shell">
    <section class="hero" aria-labelledby="page-title">
      <div class="hero-copy">
        <p class="eyebrow"><span aria-hidden="true"></span> Evidence-first job-fit analysis</p>
        <h1 id="page-title">Know where you fit. <em>Prove every claim.</em></h1>
        <p class="hero-intro">
          Compare your evidence with a role using the same deterministic engine as the CLI. Gaps
          stay visible, related experience stays related, and nothing leaves this machine.
        </p>
        <div class="landing-actions">
          <RouterLink class="hero-action" to="/analyze">
            Start a comparison
            <span aria-hidden="true">&rarr;</span>
          </RouterLink>
          <p>Paste text, review the evidence, and decide with context.</p>
        </div>
        <div class="trust-row" aria-label="Analysis guarantees">
          <span>Local only</span>
          <span>Deterministic</span>
          <span>No account</span>
        </div>
      </div>
      <aside class="hero-principles" aria-label="RoleProof principles">
        <p class="principles-label">The proof standard</p>
        <ol>
          <li><span>01</span>Evidence mapped</li>
          <li><span>02</span>Gaps made clear</li>
          <li><span>03</span>No claims invented</li>
        </ol>
      </aside>
    </section>
  </main>
</template>
