<script setup lang="ts">
import { computed, ref } from 'vue';
import type { LocalAnalyzeResponse } from '@roleproof/shared';

import { analyzeLocalStream, parseResumeFile } from '../../api/client.js';
import AnalysisResults from '../../components/AnalysisResults.vue';
import PrimaryButton from '../../components/PrimaryButton.vue';
import TextareaField from '../../components/TextareaField.vue';

const resumeText = ref('');
const resumeFile = ref<File | null>(null);
const resumeFileInput = ref<HTMLInputElement | null>(null);
const jobText = ref('');
const error = ref('');
const parseWarnings = ref<string[]>([]);
const analysisEnvelope = ref<LocalAnalyzeResponse | null>(null);
const analysisMode = ref<'deterministic' | 'ai-enhanced'>('deterministic');
const confirmProviderTransmission = ref(false);
const running = ref(false);
const progressStage = ref('');
const progressCompleted = ref(0);
const progressTotal = ref(1);
const progressMessage = ref('');

const progressPercent = computed(() =>
  Math.round((progressCompleted.value / progressTotal.value) * 100),
);

function updateProgress(event: {
  stage: string;
  completed: number;
  total: number;
  message: string;
}) {
  progressStage.value = event.stage;
  progressCompleted.value = event.completed;
  progressTotal.value = event.total;
  progressMessage.value = event.message;
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
  analysisEnvelope.value = null;
  progressStage.value = '';
  progressCompleted.value = 0;
  progressTotal.value = 1;
  progressMessage.value = 'Preparing analysis.';

  try {
    let selectedResumeText = resumeText.value;
    if (resumeFile.value !== null) {
      const parsedResume = await parseResumeFile(resumeFile.value);
      selectedResumeText = parsedResume.text;
      parseWarnings.value = parsedResume.warnings.map((warning) => warning.message);
    }
    const envelope = await analyzeLocalStream(
      {
        resumeText: selectedResumeText,
        jobText: jobText.value,
        mode: analysisMode.value,
        confirmProviderTransmission: confirmProviderTransmission.value,
      },
      { onEvent: (event) => event.kind === 'progress' && updateProgress(event) },
    );
    analysisEnvelope.value = envelope;
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

        <section class="analysis-mode-panel" aria-labelledby="analysis-mode-title">
          <div>
            <p class="panel-kicker">Analysis mode</p>
            <h3 id="analysis-mode-title">Choose evidence processing</h3>
            <p>
              Deterministic analysis stays local. AI-enhanced analysis uses your saved provider
              settings and may send redacted analysis inputs only after confirmation.
            </p>
          </div>
          <div class="mode-options" role="radiogroup" aria-labelledby="analysis-mode-title">
            <label>
              <input
                v-model="analysisMode"
                type="radio"
                name="analysis-mode"
                value="deterministic"
                :disabled="running"
              />
              <span>Deterministic baseline</span>
            </label>
            <label>
              <input
                v-model="analysisMode"
                type="radio"
                name="analysis-mode"
                value="ai-enhanced"
                :disabled="running"
              />
              <span>AI-enhanced analysis</span>
            </label>
          </div>
          <label v-if="analysisMode === 'ai-enhanced'" class="confirmation-check">
            <input v-model="confirmProviderTransmission" type="checkbox" :disabled="running" />
            <span>
              I confirm RoleProof may send redacted analysis inputs to the configured provider.
            </span>
          </label>
        </section>

        <footer class="form-footer">
          <div class="form-actions">
            <p class="local-assurance">
              <span aria-hidden="true">&bull;</span>
              Private by default. Provider use requires explicit confirmation.
            </p>
            <PrimaryButton :disabled="running">
              {{ running ? 'Analyzing evidence...' : 'Analyze role fit' }}
            </PrimaryButton>
          </div>
          <section
            v-if="running || progressMessage"
            class="analysis-progress"
            aria-live="polite"
            aria-labelledby="analysis-progress-title"
          >
            <div class="progress-labels">
              <span id="analysis-progress-title">Analysis progress</span>
              <span>{{ progressPercent }}%</span>
            </div>
            <progress :value="progressCompleted" :max="progressTotal">
              {{ progressPercent }}%
            </progress>
            <p>{{ progressMessage }}</p>
          </section>
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

    <p
      v-if="analysisMode === 'ai-enhanced' && analysisEnvelope?.schemaVersion === '1.0'"
      class="parse-warnings"
      role="status"
    >
      AI enhancement was unavailable, so RoleProof returned the deterministic fallback.
    </p>

    <AnalysisResults v-if="analysisEnvelope" :response="analysisEnvelope" />
  </main>
</template>
