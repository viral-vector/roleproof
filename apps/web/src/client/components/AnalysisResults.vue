<script setup lang="ts">
import { computed } from 'vue';
import type { LocalAnalyzeResponse } from '@roleproof/shared';

import ResultMetric from './ResultMetric.vue';
import { downloadAnalysis } from '../exports/download.js';

const props = defineProps<{
  response: LocalAnalyzeResponse;
}>();

const strongMatches = computed(
  () =>
    props.response.analysis.matchedRequirements.filter(
      (match) => match.classification === 'direct' || match.classification === 'strongly-related',
    ) ?? [],
);
const partialMatches = computed(
  () =>
    props.response.analysis.matchedRequirements.filter(
      (match) => match.classification === 'partially-related',
    ) ?? [],
);
const resultModeLabel = computed(() =>
  props.response.schemaVersion === '2.0' ? 'AI-enhanced guidance' : 'Deterministic fallback',
);

const aiEnhancement = computed(() =>
  props.response.schemaVersion === '2.0' ? props.response.aiEnhancement : null,
);

function formatLabel(value: string) {
  return value.replaceAll('-', ' ');
}

function saveAnalysis(format: 'json' | 'markdown') {
  downloadAnalysis(props.response.analysis, format);
}
</script>

<template>
  <section class="results" aria-labelledby="results-title">
    <header class="section-heading results-heading">
      <div>
        <p class="section-index">02 / Result</p>
        <h2 id="results-title">Evidence summary</h2>
      </div>
      <div class="result-heading-actions">
        <span class="mode-badge">{{ resultModeLabel }}</span>
        <button class="export-button" type="button" @click="saveAnalysis('json')">
          Download JSON
        </button>
        <button class="export-button" type="button" @click="saveAnalysis('markdown')">
          Download Markdown
        </button>
      </div>
    </header>

    <div class="result-overview">
      <div class="recommendation-card" :data-recommendation="response.analysis.recommendation">
        <span>Recommendation</span>
        <strong>{{ formatLabel(response.analysis.recommendation) }}</strong>
        <p>A fit assessment, not a prediction of interview or hiring outcomes.</p>
      </div>
      <dl class="metric-grid">
        <ResultMetric label="Fit score" :value="`${response.analysis.overallScore}/100`" />
        <ResultMetric
          label="Confidence"
          :value="`${Math.round(response.analysis.confidence * 100)}%`"
        />
        <ResultMetric
          label="Matched"
          :value="String(response.analysis.matchedRequirements.length)"
        />
        <ResultMetric
          label="Missing"
          :value="String(response.analysis.missingRequirements.length)"
        />
      </dl>
    </div>

    <section
      class="blocker-summary"
      :data-state="response.analysis.hardBlockers.length > 0 ? 'blocked' : 'clear'"
      aria-labelledby="blockers-title"
    >
      <div class="blocker-icon" aria-hidden="true">
        <span v-if="response.analysis.hardBlockers.length > 0">!</span>
        <span v-else>&#10003;</span>
      </div>
      <div>
        <h3 id="blockers-title">Eligibility blockers</h3>
        <ul v-if="response.analysis.hardBlockers.length > 0">
          <li v-for="blocker in response.analysis.hardBlockers" :key="blocker">{{ blocker }}</li>
        </ul>
        <p v-else>No hard blocker was detected from the explicit facts supplied.</p>
      </div>
    </section>

    <div v-if="aiEnhancement !== null" class="ai-output-panel">
      <header>
        <div>
          <p class="panel-kicker">Validated AI Output</p>
          <h3>What the provider returned</h3>
        </div>
        <span class="mode-badge">Schema {{ response.schemaVersion }}</span>
      </header>
      <p>
        This section shows the schema-validated AI enhancement only. The deterministic score,
        recommendation, and blockers remain unchanged.
      </p>
      <section class="ai-output-section">
        <h4>AI Requirement Interpretations</h4>
        <ul class="evidence-list compact-list">
          <li
            v-for="item in aiEnhancement!.requirementAnalysis.requirements"
            :key="item.requirementId"
          >
            <span class="classification" :data-classification="item.classification">{{
              formatLabel(item.classification)
            }}</span>
            <p>{{ item.explanation }}</p>
            <small>{{ item.evidenceIds.length }} evidence reference(s)</small>
          </li>
        </ul>
      </section>
      <section class="ai-output-section">
        <h4>AI Evidence Mappings</h4>
        <ul class="evidence-list compact-list">
          <li v-for="item in aiEnhancement!.evidenceMapping.mappings" :key="item.requirementId">
            <span class="classification" :data-classification="item.classification">{{
              formatLabel(item.classification)
            }}</span>
            <p>{{ item.explanation }}</p>
            <small>{{ item.evidenceIds.length }} evidence reference(s)</small>
          </li>
        </ul>
      </section>
      <section class="ai-output-section">
        <h4>AI Application Suggestions</h4>
        <ul class="evidence-list compact-list">
          <li
            v-for="item in aiEnhancement!.applicationSuggestions.suggestedEmphasis"
            :key="item.text"
          >
            <span class="classification" :data-classification="item.classification">{{
              formatLabel(item.classification)
            }}</span>
            <p>{{ item.text }}</p>
            <small>{{ item.explanation }}</small>
          </li>
        </ul>
      </section>
    </div>

    <div class="evidence-grid">
      <article class="evidence-panel">
        <header>
          <div>
            <p class="panel-kicker">Supported</p>
            <h3>Strong matches</h3>
          </div>
          <span class="count-badge">{{ strongMatches.length }}</span>
        </header>
        <ul v-if="strongMatches.length > 0" class="evidence-list">
          <li v-for="match in strongMatches" :key="match.requirementId">
            <span class="classification" :data-classification="match.classification">
              {{ formatLabel(match.classification) }}
            </span>
            <p>{{ match.explanation }}</p>
            <small>{{ match.evidenceIds.length }} evidence reference(s)</small>
          </li>
        </ul>
        <p v-else class="empty-state">No direct or strongly related match was found.</p>
      </article>

      <article class="evidence-panel">
        <header>
          <div>
            <p class="panel-kicker">Adjacent evidence</p>
            <h3>Partial matches</h3>
          </div>
          <span class="count-badge">{{ partialMatches.length }}</span>
        </header>
        <ul v-if="partialMatches.length > 0" class="evidence-list">
          <li v-for="match in partialMatches" :key="match.requirementId">
            <span class="classification" :data-classification="match.classification">
              {{ formatLabel(match.classification) }}
            </span>
            <p>{{ match.explanation }}</p>
            <small>{{ match.evidenceIds.length }} evidence reference(s)</small>
          </li>
        </ul>
        <p v-else class="empty-state">No partial match was found.</p>
      </article>

      <article class="evidence-panel">
        <header>
          <div>
            <p class="panel-kicker">Gap review</p>
            <h3>Missing requirements</h3>
          </div>
          <span class="count-badge">{{ response.analysis.missingRequirements.length }}</span>
        </header>
        <ul v-if="response.analysis.missingRequirements.length > 0" class="evidence-list">
          <li v-for="requirement in response.analysis.missingRequirements" :key="requirement.id">
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
          <span class="count-badge">{{ response.analysis.unsupportedClaims.length }}</span>
        </header>
        <ul
          v-if="response.analysis.unsupportedClaims.length > 0"
          class="evidence-list compact-list"
        >
          <li
            v-for="(claim, index) in response.analysis.unsupportedClaims"
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

    <div class="guidance-grid">
      <article class="evidence-panel">
        <header>
          <div>
            <p class="panel-kicker">Application guidance</p>
            <h3>Safe résumé emphasis</h3>
          </div>
          <span class="count-badge">{{ response.analysis.suggestedEmphasis.length }}</span>
        </header>
        <ul v-if="response.analysis.suggestedEmphasis.length > 0" class="evidence-list">
          <li
            v-for="(suggestion, index) in response.analysis.suggestedEmphasis"
            :key="`${suggestion.text}-${index}`"
          >
            <span class="classification" :data-classification="suggestion.classification">
              {{ formatLabel(suggestion.classification) }}
            </span>
            <p>{{ suggestion.text }}</p>
            <small>{{ suggestion.explanation }}</small>
          </li>
        </ul>
        <p v-else class="empty-state">No additional emphasis was generated.</p>
      </article>

      <article class="evidence-panel">
        <header>
          <div>
            <p class="panel-kicker">Review before use</p>
            <h3>Suggestions requiring confirmation</h3>
          </div>
          <span class="count-badge">{{ response.analysis.suggestedAdditions.length }}</span>
        </header>
        <ul v-if="response.analysis.suggestedAdditions.length > 0" class="evidence-list">
          <li
            v-for="(suggestion, index) in response.analysis.suggestedAdditions"
            :key="`${suggestion.text}-${index}`"
          >
            <span class="classification" :data-classification="suggestion.classification">
              {{ formatLabel(suggestion.classification) }}
            </span>
            <p>{{ suggestion.text }}</p>
            <small>{{ suggestion.explanation }}</small>
          </li>
        </ul>
        <p v-else class="empty-state">No addition requiring confirmation was generated.</p>
      </article>

      <article class="evidence-panel">
        <header>
          <div>
            <p class="panel-kicker">Prepare</p>
            <h3>Interview topics</h3>
          </div>
          <span class="count-badge">{{ response.analysis.interviewTopics.length }}</span>
        </header>
        <ul v-if="response.analysis.interviewTopics.length > 0" class="topic-list">
          <li v-for="topic in response.analysis.interviewTopics" :key="topic">{{ topic }}</li>
        </ul>
        <p v-else class="empty-state">No interview topic was generated.</p>
      </article>
    </div>

    <footer class="result-footer">
      <span>Engine {{ response.analysis.metadata.engineVersion }}</span>
      <span>Schema {{ response.analysis.schemaVersion }}</span>
      <span>Generated locally</span>
    </footer>
  </section>
</template>
