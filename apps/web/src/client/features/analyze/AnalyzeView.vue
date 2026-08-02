<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { LocalAnalyzeResponse, LocalResumeSource, LocalSettings } from '@roleproof/shared';

import {
  analyzeLocalStream,
  getSettings,
  listProviderModels,
  parseResumeFile,
  updateSettings,
} from '../../api/client.js';
import AnalysisResults from '../../components/AnalysisResults.vue';
import PrimaryButton from '../../components/PrimaryButton.vue';
import TextareaField from '../../components/TextareaField.vue';

const resumeText = ref('');
const resumeFile = ref<File | null>(null);
const resumeFileInput = ref<HTMLInputElement | null>(null);
const resumeSource = ref<LocalResumeSource | null>(null);
const jobText = ref('');
const jobUrl = ref('');
const error = ref('');
const parseWarnings = ref<string[]>([]);
const analysisEnvelope = ref<LocalAnalyzeResponse | null>(null);
const analysisMode = ref<'deterministic' | 'ai-enhanced'>('deterministic');
const lastRunMode = ref<'deterministic' | 'ai-enhanced' | null>(null);
const confirmProviderTransmission = ref(false);
const running = ref(false);
const progressStage = ref('');
const progressCompleted = ref(0);
const progressTotal = ref(1);
const progressMessage = ref('');
const disclosureSettings = ref<LocalSettings | null>(null);
const disclosureLoading = ref(false);
const disclosureError = ref('');
const providerDraft = ref<'openai' | 'openai-compatible'>('openai-compatible');
const modelDraft = ref('');
const availableModels = ref<Array<{ id: string }>>([]);
const loadingModels = ref(false);
const applyingProviderSettings = ref(false);
const providerSettingsError = ref('');
const providerSettingsNotice = ref('');

const progressPercent = computed(() =>
  Math.round((progressCompleted.value / progressTotal.value) * 100),
);

const trimmedJobUrl = computed(() => jobUrl.value.trim());
const hasJobUrl = computed(() => trimmedJobUrl.value.length > 0);

const disclosureConfigured = computed(
  () => disclosureSettings.value?.provider != null && disclosureSettings.value?.model != null,
);

const effectiveDestination = computed(() => {
  const settings = disclosureSettings.value;
  if (settings?.destination != null) return settings.destination;
  return settings?.provider === 'openai' ? 'hosted' : 'local';
});

const providerLabel = computed(() => {
  const provider = disclosureSettings.value?.provider;
  if (provider === 'openai') return 'OpenAI (hosted)';
  if (provider === 'openai-compatible') return 'OpenAI-compatible';
  return 'Not configured';
});

const modelLabel = computed(() => disclosureSettings.value?.model ?? 'Not configured');

const destinationLabel = computed(() => {
  switch (effectiveDestination.value) {
    case 'hosted':
      return 'Hosted';
    case 'custom':
      return 'Custom endpoint';
    case 'local':
      return 'Local (this machine)';
  }
});

const endpointLabel = computed(() => {
  const baseUrl = disclosureSettings.value?.baseUrl;
  if (baseUrl != null && baseUrl.trim().length > 0) return baseUrl;
  if (disclosureSettings.value?.provider === 'openai') return 'https://api.openai.com';
  return 'Provider default endpoint';
});

const redactionLabel = computed(() => {
  const settings = disclosureSettings.value;
  if (settings == null) return 'Not configured';
  const parts = ['Email addresses', 'Phone numbers', 'Addresses'];
  if (settings.redactEmployer === true) parts.push('Employer names');
  if (settings.redactClearance === true) parts.push('Clearance details');
  if (settings.redactionTerms != null && settings.redactionTerms.length > 0) {
    parts.push(...settings.redactionTerms);
  }
  return parts.join('; ');
});

const dataLeavesMachine = computed(
  () => effectiveDestination.value === 'hosted' || effectiveDestination.value === 'custom',
);

const providerSelectionDirty = computed(() => {
  const settings = disclosureSettings.value;
  if (settings == null) return true;
  return providerDraft.value !== settings.provider || modelDraft.value !== (settings.model ?? '');
});

function applyDisclosureSettings(settings: LocalSettings) {
  disclosureSettings.value = settings;
  providerDraft.value = settings.provider === 'openai' ? 'openai' : 'openai-compatible';
  modelDraft.value = settings.model ?? '';
  availableModels.value = modelDraft.value.length === 0 ? [] : [{ id: modelDraft.value }];
}

function transmissionSettingsKey(settings: LocalSettings | null): string {
  if (settings == null) return '';
  return JSON.stringify({
    provider: settings.provider ?? null,
    model: settings.model ?? null,
    destination: settings.destination ?? (settings.provider === 'openai' ? 'hosted' : 'local'),
    baseUrl: settings.provider === 'openai' ? null : (settings.baseUrl ?? null),
    redactEmployer: settings.redactEmployer ?? false,
    redactClearance: settings.redactClearance ?? false,
    redactionTerms: settings.redactionTerms ?? [],
  });
}

function invalidateProviderConsent() {
  confirmProviderTransmission.value = false;
  providerSettingsError.value = '';
  providerSettingsNotice.value = '';
}

function changeProvider() {
  invalidateProviderConsent();
  modelDraft.value = '';
  availableModels.value = [];
}

function targetProviderEndpoint() {
  const settings = disclosureSettings.value;
  if (providerDraft.value === 'openai') {
    return { destination: 'hosted' as const, baseUrl: null };
  }
  if (settings?.provider === 'openai-compatible') {
    return {
      destination: settings.destination ?? ('local' as const),
      baseUrl: settings.baseUrl ?? 'http://localhost:11434/v1',
    };
  }
  return { destination: 'local' as const, baseUrl: 'http://localhost:11434/v1' };
}

async function loadModels() {
  invalidateProviderConsent();
  loadingModels.value = true;
  try {
    const endpoint = targetProviderEndpoint();
    const response = await listProviderModels({
      provider: providerDraft.value,
      destination: endpoint.destination,
      baseUrl: endpoint.baseUrl,
      model: modelDraft.value === '' ? null : modelDraft.value,
    });
    availableModels.value = response.models;
    modelDraft.value = response.models.some((model) => model.id === modelDraft.value)
      ? modelDraft.value
      : (response.models[0]?.id ?? '');
    providerSettingsNotice.value =
      response.models.length === 0
        ? 'No provider models were returned.'
        : 'Provider models loaded.';
  } catch (cause) {
    availableModels.value = modelDraft.value === '' ? [] : [{ id: modelDraft.value }];
    providerSettingsError.value =
      cause instanceof Error ? cause.message : 'Provider models are unavailable.';
  } finally {
    loadingModels.value = false;
  }
}

async function applyProviderSettings() {
  invalidateProviderConsent();
  const model = modelDraft.value;
  if (model === '') {
    providerSettingsError.value = 'Load and select a model before applying provider settings.';
    return;
  }

  applyingProviderSettings.value = true;
  try {
    const endpoint = targetProviderEndpoint();
    const response = await updateSettings({
      ...(disclosureSettings.value ?? {}),
      provider: providerDraft.value,
      model,
      destination: endpoint.destination,
      baseUrl: endpoint.baseUrl,
    });
    applyDisclosureSettings(response.settings);
    disclosureError.value = '';
    providerSettingsNotice.value = 'Provider settings applied.';
  } catch (cause) {
    providerSettingsError.value =
      cause instanceof Error ? cause.message : 'Provider settings could not be applied.';
  } finally {
    applyingProviderSettings.value = false;
  }
}

async function loadDisclosure() {
  disclosureLoading.value = true;
  disclosureError.value = '';
  confirmProviderTransmission.value = false;
  try {
    const response = await getSettings();
    applyDisclosureSettings(response.settings);
  } catch (cause) {
    disclosureSettings.value = null;
    disclosureError.value =
      cause instanceof Error ? cause.message : 'Provider configuration is unavailable.';
  } finally {
    disclosureLoading.value = false;
  }
}

watch(analysisMode, (mode) => {
  if (mode === 'ai-enhanced') void loadDisclosure();
});

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
  resumeSource.value = null;
  parseWarnings.value = [];
  error.value = '';
}

function clearResumeFile() {
  resumeFile.value = null;
  resumeSource.value = null;
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
    if (analysisMode.value === 'ai-enhanced') {
      if (!confirmProviderTransmission.value) {
        throw new Error('Review the AI transmission disclosure and confirm provider use.');
      }
      const currentSettings = (await getSettings()).settings;
      if (
        transmissionSettingsKey(currentSettings) !==
        transmissionSettingsKey(disclosureSettings.value)
      ) {
        applyDisclosureSettings(currentSettings);
        confirmProviderTransmission.value = false;
        providerSettingsNotice.value = '';
        throw new Error(
          'Provider settings changed. Review the updated disclosure and confirm again.',
        );
      }
    }
    let selectedResumeText = resumeText.value;
    if (resumeFile.value !== null) {
      const parsedResume = await parseResumeFile(resumeFile.value);
      selectedResumeText = parsedResume.text;
      parseWarnings.value = parsedResume.warnings.map((warning) => warning.message);
      resumeSource.value =
        parsedResume.confidence === undefined
          ? null
          : {
              format: parsedResume.format,
              fileName: parsedResume.fileName,
              contentSha256: parsedResume.contentSha256,
              confidence: parsedResume.confidence,
              warnings: parsedResume.warnings,
            };
    } else {
      resumeSource.value = null;
    }
    const envelope = await analyzeLocalStream(
      {
        resumeText: selectedResumeText,
        jobText: jobText.value,
        jobUrl: hasJobUrl.value ? trimmedJobUrl.value : undefined,
        mode: analysisMode.value,
        confirmProviderTransmission: confirmProviderTransmission.value,
        ...(resumeSource.value === null ? {} : { resumeSource: resumeSource.value }),
      },
      { onEvent: (event) => event.kind === 'progress' && updateProgress(event) },
    );
    analysisEnvelope.value = envelope;
    lastRunMode.value = analysisMode.value;
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

          <section class="field-group job-source-card" aria-labelledby="job-source-title">
            <div class="field-heading">
              <div>
                <span class="field-kicker">Role source</span>
                <h3 id="job-source-title">Role source</h3>
              </div>
              <span id="job-text-count" class="character-count">
                {{ jobText.length.toLocaleString() }} chars pasted
              </span>
            </div>
            <p id="job-source-help">
              Fetch an official posting at analysis time, or paste the role text manually.
            </p>

            <label class="job-text-label" for="job-text">Job description</label>
            <textarea
              id="job-text"
              v-model="jobText"
              aria-describedby="job-source-help job-text-count"
              placeholder="Paste job description here..."
              :required="!hasJobUrl"
              rows="10"
            />

            <div class="input-divider"><span>or fetch from URL</span></div>

            <label class="job-url-card" for="job-url">
              <span class="job-url-label">Use job URL</span>
              <span class="job-url-copy">
                RoleProof fetches this page only when you run analysis and records source metadata.
              </span>
              <input
                id="job-url"
                v-model="jobUrl"
                type="url"
                inputmode="url"
                placeholder="https://boards.greenhouse.io/example/jobs/123"
                aria-describedby="job-source-help job-url-note"
                :disabled="running"
              />
              <span id="job-url-note" class="job-url-note">
                If a URL is provided, fetched job text is used for the analysis.
              </span>
            </label>
          </section>
        </div>

        <section class="analysis-mode-panel" aria-labelledby="analysis-mode-title">
          <div>
            <p class="panel-kicker">Analysis mode</p>
            <h3 id="analysis-mode-title">Choose evidence processing</h3>
            <p>
              Deterministic analysis stays local. AI-enhanced analysis uses provider settings
              applied below and may send redacted analysis inputs only after confirmation.
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
          <section
            v-if="analysisMode === 'ai-enhanced'"
            class="provider-disclosure"
            aria-labelledby="provider-disclosure-title"
          >
            <div class="disclosure-heading">
              <p class="panel-kicker">Before transmission</p>
              <h4 id="provider-disclosure-title">AI transmission disclosure</h4>
            </div>
            <p v-if="disclosureLoading" class="disclosure-note" role="status">
              Loading provider configuration...
            </p>
            <template v-else>
              <div class="provider-selection">
                <label>
                  <span>Analysis provider</span>
                  <select
                    v-model="providerDraft"
                    :disabled="running || applyingProviderSettings"
                    @change="changeProvider"
                  >
                    <option value="openai-compatible">OpenAI-compatible</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </label>
                <label>
                  <span>Analysis model</span>
                  <select
                    v-model="modelDraft"
                    :disabled="
                      running ||
                      applyingProviderSettings ||
                      loadingModels ||
                      availableModels.length === 0
                    "
                    @change="invalidateProviderConsent"
                  >
                    <option v-if="availableModels.length === 0" value="">
                      Load models to select
                    </option>
                    <option v-for="model in availableModels" :key="model.id" :value="model.id">
                      {{ model.id }}
                    </option>
                  </select>
                </label>
                <button
                  class="export-button"
                  type="button"
                  :disabled="running || applyingProviderSettings || loadingModels"
                  @click="loadModels"
                >
                  {{ loadingModels ? 'Loading models...' : 'Load models' }}
                </button>
                <button
                  class="export-button"
                  type="button"
                  :disabled="
                    running ||
                    applyingProviderSettings ||
                    loadingModels ||
                    disclosureLoading ||
                    modelDraft === '' ||
                    !providerSelectionDirty
                  "
                  @click="applyProviderSettings"
                >
                  {{ applyingProviderSettings ? 'Applying...' : 'Apply provider settings' }}
                </button>
              </div>
              <p v-if="providerSettingsError" class="disclosure-warning" role="alert">
                {{ providerSettingsError }}
              </p>
              <p v-if="providerSettingsNotice" class="disclosure-note" role="status">
                {{ providerSettingsNotice }}
              </p>
              <p v-if="disclosureError" class="disclosure-warning" role="alert">
                {{ disclosureError }}
              </p>
              <dl v-else class="disclosure-list">
                <div>
                  <dt>Provider</dt>
                  <dd>{{ providerLabel }}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{{ modelLabel }}</dd>
                </div>
                <div>
                  <dt>Destination</dt>
                  <dd>{{ destinationLabel }}</dd>
                </div>
                <div>
                  <dt>Endpoint</dt>
                  <dd>{{ endpointLabel }}</dd>
                </div>
                <div>
                  <dt>Redaction</dt>
                  <dd>{{ redactionLabel }}</dd>
                </div>
              </dl>
              <p v-if="dataLeavesMachine" class="disclosure-warning" role="note">
                Redacted analysis inputs will leave this machine and be sent to
                {{ endpointLabel }}.
              </p>
              <p v-if="!disclosureConfigured" class="disclosure-warning" role="alert">
                No AI provider is configured. Open Settings and configure a provider before
                AI-enhanced analysis.
              </p>
            </template>
            <label class="confirmation-check">
              <input
                v-model="confirmProviderTransmission"
                type="checkbox"
                :disabled="
                  running ||
                  disclosureLoading ||
                  applyingProviderSettings ||
                  providerSelectionDirty ||
                  !disclosureConfigured
                "
              />
              <span>
                I confirm RoleProof may send redacted analysis inputs to the configured provider.
              </span>
            </label>
          </section>
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
      v-if="lastRunMode === 'ai-enhanced' && analysisEnvelope?.schemaVersion === '1.0'"
      class="parse-warnings"
      role="status"
    >
      AI enhancement was unavailable, so RoleProof returned the deterministic fallback.
    </p>

    <AnalysisResults
      v-if="analysisEnvelope"
      :response="analysisEnvelope"
      :submitted-mode="lastRunMode"
    />
  </main>
</template>
