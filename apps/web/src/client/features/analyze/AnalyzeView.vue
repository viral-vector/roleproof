<script setup lang="ts">
import { ref } from 'vue';
import type { LocalAnalyzeResponse } from '@roleproof/shared';

import { analyzeLocal } from '../../api/client.js';
import PrimaryButton from '../../components/PrimaryButton.vue';
import ResultMetric from '../../components/ResultMetric.vue';
import TextareaField from '../../components/TextareaField.vue';

const resumeText = ref('');
const jobText = ref('');
const error = ref('');
const analysis = ref<LocalAnalyzeResponse['analysis'] | null>(null);
const running = ref(false);

function formatLabel(value: string) {
  return value.replaceAll('-', ' ');
}

async function runAnalysis() {
  running.value = true;
  error.value = '';
  analysis.value = null;

  try {
    const envelope = await analyzeLocal({ resumeText: resumeText.value, jobText: jobText.value });
    analysis.value = envelope.analysis;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Analysis failed.';
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <main class="shell">
    <section class="workspace" aria-labelledby="workspace-title">
      <header class="section-heading">
        <div>
          <p class="section-index">01 / Input</p>
          <h2 id="workspace-title">Build the evidence comparison</h2>
        </div>
        <p>Both documents are processed in memory by your local server.</p>
      </header>

      <form class="analysis-form" :aria-busy="running" @submit.prevent="runAnalysis">
        <div class="input-grid">
          <TextareaField
            id="resume-text"
            v-model="resumeText"
            kicker="Candidate evidence"
            label="Resume text"
            help="Paste résumé or career evidence. Files are never uploaded automatically."
            placeholder="Paste resume text here..."
          />

          <TextareaField
            id="job-text"
            v-model="jobText"
            kicker="Role requirements"
            label="Job description"
            help="Paste the role description. URL fetching is not enabled in this phase."
            placeholder="Paste job description here..."
          />
        </div>

        <footer class="form-footer">
          <p class="local-assurance">
            <span aria-hidden="true">&bull;</span>
            Private by default. No cloud connection is used.
          </p>
          <PrimaryButton :disabled="running">
            {{ running ? 'Analyzing evidence...' : 'Analyze role fit' }}
          </PrimaryButton>
        </footer>
      </form>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section v-if="analysis" class="results" aria-labelledby="results-title">
      <header class="section-heading results-heading">
        <div>
          <p class="section-index">02 / Result</p>
          <h2 id="results-title">Evidence summary</h2>
        </div>
        <span class="mode-badge">Deterministic baseline</span>
      </header>

      <div class="result-overview">
        <div class="recommendation-card" :data-recommendation="analysis.recommendation">
          <span>Recommendation</span>
          <strong>{{ formatLabel(analysis.recommendation) }}</strong>
          <p>A fit assessment, not a prediction of interview or hiring outcomes.</p>
        </div>
        <dl class="metric-grid">
          <ResultMetric label="Fit score" :value="`${analysis.overallScore}/100`" />
          <ResultMetric label="Confidence" :value="`${Math.round(analysis.confidence * 100)}%`" />
          <ResultMetric label="Matched" :value="String(analysis.matchedRequirements.length)" />
          <ResultMetric label="Missing" :value="String(analysis.missingRequirements.length)" />
        </dl>
      </div>

      <section
        class="blocker-summary"
        :data-state="analysis.hardBlockers.length > 0 ? 'blocked' : 'clear'"
        aria-labelledby="blockers-title"
      >
        <div class="blocker-icon" aria-hidden="true">
          <span v-if="analysis.hardBlockers.length > 0">!</span>
          <span v-else>&#10003;</span>
        </div>
        <div>
          <h3 id="blockers-title">Eligibility blockers</h3>
          <ul v-if="analysis.hardBlockers.length > 0">
            <li v-for="blocker in analysis.hardBlockers" :key="blocker">{{ blocker }}</li>
          </ul>
          <p v-else>No hard blocker was detected from the explicit facts supplied.</p>
        </div>
      </section>

      <div class="evidence-grid">
        <article class="evidence-panel">
          <header>
            <div>
              <p class="panel-kicker">Supported</p>
              <h3>Matched evidence</h3>
            </div>
            <span class="count-badge">{{ analysis.matchedRequirements.length }}</span>
          </header>
          <ul v-if="analysis.matchedRequirements.length > 0" class="evidence-list">
            <li v-for="match in analysis.matchedRequirements" :key="match.requirementId">
              <span class="classification" :data-classification="match.classification">
                {{ formatLabel(match.classification) }}
              </span>
              <p>{{ match.explanation }}</p>
              <small>{{ match.evidenceIds.length }} evidence reference(s)</small>
            </li>
          </ul>
          <p v-else class="empty-state">No supported requirement matches were found.</p>
        </article>

        <article class="evidence-panel">
          <header>
            <div>
              <p class="panel-kicker">Gap review</p>
              <h3>Missing requirements</h3>
            </div>
            <span class="count-badge">{{ analysis.missingRequirements.length }}</span>
          </header>
          <ul v-if="analysis.missingRequirements.length > 0" class="evidence-list">
            <li v-for="requirement in analysis.missingRequirements" :key="requirement.id">
              <span class="classification" data-classification="unsupported">
                {{ requirement.importance }} &middot; {{ requirement.category }}
              </span>
              <p>{{ requirement.text }}</p>
            </li>
          </ul>
          <p v-else class="empty-state">No missing requirements were identified.</p>
        </article>

        <article class="evidence-panel evidence-panel-wide">
          <header>
            <div>
              <p class="panel-kicker">Truth check</p>
              <h3>Unsupported claims</h3>
            </div>
            <span class="count-badge">{{ analysis.unsupportedClaims.length }}</span>
          </header>
          <ul v-if="analysis.unsupportedClaims.length > 0" class="evidence-list compact-list">
            <li
              v-for="(claim, index) in analysis.unsupportedClaims"
              :key="`${claim.text}-${index}`"
            >
              <span class="classification" :data-classification="claim.classification">
                {{ formatLabel(claim.classification) }}
              </span>
              <p>{{ claim.text }}</p>
              <small>{{ claim.explanation }}</small>
            </li>
          </ul>
          <p v-else class="empty-state">No unsupported claims were generated.</p>
        </article>
      </div>

      <footer class="result-footer">
        <span>Engine {{ analysis.metadata.engineVersion }}</span>
        <span>Schema {{ analysis.schemaVersion }}</span>
        <span>Generated locally</span>
      </footer>
    </section>
  </main>
</template>
