<script setup lang="ts">
import { ref } from 'vue';
import type { LocalAnalyzeResponse } from '@roleproof/shared';

import { analyzeLocal, parseResumeFile } from '../../api/client.js';
import AnalysisResults from '../../components/AnalysisResults.vue';
import PrimaryButton from '../../components/PrimaryButton.vue';
import TextareaField from '../../components/TextareaField.vue';

const resumeText = ref('');
const resumeFile = ref<File | null>(null);
const resumeFileInput = ref<HTMLInputElement | null>(null);
const jobText = ref('');
const error = ref('');
const parseWarnings = ref<string[]>([]);
const analysis = ref<LocalAnalyzeResponse['analysis'] | null>(null);
const running = ref(false);

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

    <AnalysisResults v-if="analysis" :analysis="analysis" />
  </main>
</template>
