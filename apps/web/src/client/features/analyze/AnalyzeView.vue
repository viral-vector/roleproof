<script setup lang="ts">
import { computed, ref } from 'vue';
import type { LocalAnalyzeResponse } from '@roleproof/shared';

import { analyzeLocal, parseResumeFile } from '../../api/client.js';
import PrimaryButton from '../../components/PrimaryButton.vue';
import ResultMetric from '../../components/ResultMetric.vue';
import TextareaField from '../../components/TextareaField.vue';
import { downloadAnalysis } from '../../exports/download.js';

const resumeText = ref('');
const resumeFile = ref<File | null>(null);
const resumeFileInput = ref<HTMLInputElement | null>(null);
const jobText = ref('');
const error = ref('');
const parseWarnings = ref<string[]>([]);
const analysis = ref<LocalAnalyzeResponse['analysis'] | null>(null);
const running = ref(false);
const strongMatches = computed(
  () =>
    analysis.value?.matchedRequirements.filter(
      (match) => match.classification === 'direct' || match.classification === 'strongly-related',
    ) ?? [],
);
const partialMatches = computed(
  () =>
    analysis.value?.matchedRequirements.filter(
      (match) => match.classification === 'partially-related',
    ) ?? [],
);

function formatLabel(value: string) {
  return value.replaceAll('-', ' ');
}

function saveAnalysis(format: 'json' | 'markdown') {
  if (analysis.value !== null) downloadAnalysis(analysis.value, format);
}

function selectResumeFile(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  resumeFile.value = input.files?.[0] ?? null;
  parseWarnings.value = [];
  error.value = '';
}

function clearResumeFile() {
  resumeFile.value = null;
  if (resumeFileInput.value !== null) resumeFileInput.value.value = '';
}

async function runAnalysis() {
  running.value = true;
  error.value = '';
  parseWarnings.value = [];
  analysis.value = null;

  try {
    let selectedResumeText = resumeText.value;
    if (resumeFile.value !== null) {
      const parsedResume = await parseResumeFile(resumeFile.value);
      selectedResumeText = parsedResume.text;
      parseWarnings.value = parsedResume.warnings.map((warning) => warning.message);
    }
    const envelope = await analyzeLocal({
      resumeText: selectedResumeText,
      jobText: jobText.value,
    });
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
            help="Choose a résumé file or paste career evidence below."
            placeholder="Paste resume text here..."
            :required="resumeFile === null"
          >
            <template #before>
              <div class="file-picker">
                <div class="file-picker-copy">
                  <label for="resume-file">Resume file</label>
                  <span>TXT up to 1 MB or PDF/DOCX up to 10 MB</span>
                </div>
                <p id="resume-file-help">Selection stays in your browser until you run analysis.</p>
                <input
                  id="resume-file"
                  ref="resumeFileInput"
                  class="file-input"
                  name="resume"
                  type="file"
                  accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  aria-describedby="resume-file-help"
                  :disabled="running"
                  @change="selectResumeFile"
                />
                <div v-if="resumeFile" class="selected-file" role="status">
                  <span>{{ resumeFile.name }}</span>
                  <button type="button" :disabled="running" @click="clearResumeFile">Remove</button>
                </div>
              </div>
              <div class="input-divider"><span>or paste text</span></div>
            </template>
          </TextareaField>

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

    <section v-if="parseWarnings.length > 0" class="parse-warnings" aria-live="polite">
      <h2>Resume parser notice</h2>
      <ul>
        <li v-for="warning in parseWarnings" :key="warning">{{ warning }}</li>
      </ul>
    </section>

    <section v-if="analysis" class="results" aria-labelledby="results-title">
      <header class="section-heading results-heading">
        <div>
          <p class="section-index">02 / Result</p>
          <h2 id="results-title">Evidence summary</h2>
        </div>
        <div class="result-heading-actions">
          <span class="mode-badge">Deterministic baseline</span>
          <button class="export-button" type="button" @click="saveAnalysis('json')">
            Download JSON
          </button>
          <button class="export-button" type="button" @click="saveAnalysis('markdown')">
            Download Markdown
          </button>
        </div>
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

      <div class="guidance-grid">
        <article class="evidence-panel">
          <header>
            <div>
              <p class="panel-kicker">Application guidance</p>
              <h3>Safe résumé emphasis</h3>
            </div>
            <span class="count-badge">{{ analysis.suggestedEmphasis.length }}</span>
          </header>
          <ul v-if="analysis.suggestedEmphasis.length > 0" class="evidence-list">
            <li
              v-for="(suggestion, index) in analysis.suggestedEmphasis"
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
            <span class="count-badge">{{ analysis.suggestedAdditions.length }}</span>
          </header>
          <ul v-if="analysis.suggestedAdditions.length > 0" class="evidence-list">
            <li
              v-for="(suggestion, index) in analysis.suggestedAdditions"
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
            <span class="count-badge">{{ analysis.interviewTopics.length }}</span>
          </header>
          <ul v-if="analysis.interviewTopics.length > 0" class="topic-list">
            <li v-for="topic in analysis.interviewTopics" :key="topic">{{ topic }}</li>
          </ul>
          <p v-else class="empty-state">No interview topic was generated.</p>
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
