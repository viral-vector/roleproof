<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type {
  LocalProviderCredentialProvider,
  LocalProviderCredentialStatus,
  LocalSettings,
} from '@roleproof/shared';

import {
  deleteProviderCredential,
  getProviderCredentialStatus,
  getSettings,
  listProviderModels,
  saveProviderCredential,
  updateSettings,
} from '../../api/client.js';
import PrimaryButton from '../../components/PrimaryButton.vue';

const settings = ref<LocalSettings>({});
const databasePath = ref('');
const provider = ref('');
const model = ref('');
const destination = ref('');
const baseUrl = ref('');
const redactEmployer = ref(false);
const redactClearance = ref(false);
const redactionTerms = ref('');
const defaultExportFormat = ref('');
const maxTotalTokens = ref('');
const maxCostUsd = ref('');
const inputMicroUsdPerMillionTokens = ref('');
const outputMicroUsdPerMillionTokens = ref('');
const providerTimeoutMs = ref('');
const structuredOutputMode = ref('');
const apiKey = ref('');
const credentialStatus = ref<LocalProviderCredentialStatus[]>([]);
const availableModels = ref<Array<{ id: string }>>([]);
const error = ref('');
const notice = ref('');
const loading = ref(true);
const saving = ref(false);
const savingCredential = ref(false);
const loadingModels = ref(false);

function credentialProvider(): LocalProviderCredentialProvider {
  return provider.value === 'openai-compatible' ? 'openai-compatible' : 'openai';
}

function credentialLabel(status: LocalProviderCredentialStatus | undefined): string {
  if (status === undefined || !status.configured) return 'No API key configured.';
  return status.source === 'environment'
    ? 'API key provided by environment.'
    : 'API key stored in OS credential manager.';
}

function currentCredentialStatus(): LocalProviderCredentialStatus | undefined {
  const selected = credentialProvider();
  return credentialStatus.value.find((item) => item.provider === selected);
}

function applyLoaded(loaded: LocalSettings) {
  settings.value = loaded;
  provider.value = loaded.provider ?? '';
  model.value = loaded.model ?? '';
  destination.value = loaded.destination ?? '';
  baseUrl.value = loaded.baseUrl ?? '';
  redactEmployer.value = loaded.redactEmployer ?? false;
  redactClearance.value = loaded.redactClearance ?? false;
  redactionTerms.value = (loaded.redactionTerms ?? []).join(', ');
  defaultExportFormat.value = loaded.defaultExportFormat ?? '';
  maxTotalTokens.value = loaded.maxTotalTokens == null ? '' : String(loaded.maxTotalTokens);
  maxCostUsd.value = loaded.maxCostUsd == null ? '' : String(loaded.maxCostUsd);
  inputMicroUsdPerMillionTokens.value =
    loaded.inputMicroUsdPerMillionTokens == null
      ? ''
      : String(loaded.inputMicroUsdPerMillionTokens);
  outputMicroUsdPerMillionTokens.value =
    loaded.outputMicroUsdPerMillionTokens == null
      ? ''
      : String(loaded.outputMicroUsdPerMillionTokens);
  providerTimeoutMs.value =
    loaded.providerTimeoutMs == null ? '' : String(loaded.providerTimeoutMs);
  structuredOutputMode.value = loaded.structuredOutputMode ?? '';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [response, credentials] = await Promise.all([
      getSettings(),
      getProviderCredentialStatus(),
    ]);
    databasePath.value = response.databasePath;
    credentialStatus.value = credentials.credentials;
    applyLoaded(response.settings);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Settings are unavailable.';
  } finally {
    loading.value = false;
  }
}

async function refreshCredentialStatus() {
  const credentials = await getProviderCredentialStatus();
  credentialStatus.value = credentials.credentials;
}

async function saveApiKey() {
  savingCredential.value = true;
  error.value = '';
  notice.value = '';
  try {
    await saveProviderCredential({ provider: credentialProvider(), apiKey: apiKey.value });
    apiKey.value = '';
    await refreshCredentialStatus();
    notice.value = 'API key saved to the OS credential manager.';
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'Provider credential could not be saved.';
  } finally {
    savingCredential.value = false;
  }
}

async function removeApiKey() {
  savingCredential.value = true;
  error.value = '';
  notice.value = '';
  try {
    await deleteProviderCredential(credentialProvider());
    await refreshCredentialStatus();
    notice.value = 'Stored API key removed.';
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'Provider credential could not be removed.';
  } finally {
    savingCredential.value = false;
  }
}

async function loadModels() {
  if (provider.value !== 'openai' && provider.value !== 'openai-compatible') {
    error.value = 'Select a provider before loading models.';
    return;
  }
  loadingModels.value = true;
  error.value = '';
  notice.value = '';
  try {
    const response = await listProviderModels({
      provider: provider.value,
      destination:
        destination.value === '' ? null : (destination.value as LocalSettings['destination']),
      baseUrl: baseUrl.value.trim() === '' ? null : baseUrl.value.trim(),
      model: model.value.trim() === '' ? null : model.value.trim(),
    });
    availableModels.value = response.models;
    notice.value =
      response.models.length === 0
        ? 'No provider models were returned.'
        : 'Provider models loaded.';
  } catch (cause) {
    availableModels.value = [];
    error.value = cause instanceof Error ? cause.message : 'Provider models are unavailable.';
  } finally {
    loadingModels.value = false;
  }
}

async function save() {
  saving.value = true;
  error.value = '';
  notice.value = '';
  const payload: LocalSettings = {};
  payload.provider = provider.value === '' ? null : (provider.value as LocalSettings['provider']);
  payload.model = provider.value === '' || model.value.trim() === '' ? null : model.value.trim();
  payload.destination =
    destination.value === '' ? null : (destination.value as LocalSettings['destination']);
  payload.baseUrl = baseUrl.value.trim() === '' ? null : baseUrl.value.trim();
  payload.redactEmployer = redactEmployer.value;
  payload.redactClearance = redactClearance.value;
  const terms = redactionTerms.value
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  payload.redactionTerms = terms;
  payload.defaultExportFormat =
    defaultExportFormat.value === ''
      ? null
      : (defaultExportFormat.value as LocalSettings['defaultExportFormat']);
  payload.maxTotalTokens = maxTotalTokens.value === '' ? null : Number(maxTotalTokens.value);
  payload.maxCostUsd = maxCostUsd.value === '' ? null : Number(maxCostUsd.value);
  payload.inputMicroUsdPerMillionTokens =
    inputMicroUsdPerMillionTokens.value === '' ? null : Number(inputMicroUsdPerMillionTokens.value);
  payload.outputMicroUsdPerMillionTokens =
    outputMicroUsdPerMillionTokens.value === ''
      ? null
      : Number(outputMicroUsdPerMillionTokens.value);
  payload.providerTimeoutMs =
    providerTimeoutMs.value === '' ? null : Number(providerTimeoutMs.value);
  payload.structuredOutputMode =
    structuredOutputMode.value === ''
      ? null
      : (structuredOutputMode.value as LocalSettings['structuredOutputMode']);

  try {
    const response = await updateSettings(payload);
    applyLoaded(response.settings);
    databasePath.value = response.databasePath;
    notice.value = 'Settings saved locally.';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Settings could not be saved.';
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <main class="shell">
    <section class="workspace" aria-labelledby="settings-title">
      <header class="section-heading">
        <div>
          <p class="section-index">Local configuration</p>
          <h2 id="settings-title">Settings</h2>
        </div>
        <p>
          Stored in the local database. Settings and career content stay local; loading models sends
          only a metadata request to the configured provider endpoint.
        </p>
      </header>

      <form class="settings-form" @submit.prevent="save">
        <fieldset class="settings-fieldset" :disabled="loading">
          <legend>AI enhancement</legend>
          <p class="fieldset-note">
            Optional. Deterministic analysis never requires a provider; these limits apply when AI
            enhancement is enabled.
          </p>
          <div class="settings-grid">
            <div class="settings-field">
              <label for="settings-provider">Provider</label>
              <select id="settings-provider" v-model="provider">
                <option value="">None</option>
                <option value="openai">OpenAI (hosted)</option>
                <option value="openai-compatible">OpenAI-compatible (custom)</option>
              </select>
            </div>
            <div class="settings-field">
              <label for="settings-model">Model</label>
              <select v-if="availableModels.length > 0" id="settings-model-select" v-model="model">
                <option value="">Select a provider model</option>
                <option v-for="item in availableModels" :key="item.id" :value="item.id">
                  {{ item.id }}
                </option>
              </select>
              <input
                id="settings-model"
                v-model="model"
                class="settings-input"
                type="text"
                maxlength="255"
                placeholder="Required when a provider is selected; manual fallback is allowed"
              />
              <button
                class="secondary-button"
                type="button"
                :disabled="loadingModels || provider === ''"
                @click="loadModels"
              >
                {{ loadingModels ? 'Loading models...' : 'Load models' }}
              </button>
            </div>
            <div class="settings-field">
              <label for="settings-destination">Destination</label>
              <select id="settings-destination" v-model="destination">
                <option value="">Default</option>
                <option value="hosted">Hosted</option>
                <option value="local">Local</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div class="settings-field settings-field-wide">
              <label for="settings-base-url">API base URL</label>
              <input
                id="settings-base-url"
                v-model="baseUrl"
                class="settings-input"
                type="url"
                maxlength="2048"
                placeholder="Required for openai-compatible providers"
              />
            </div>
            <div class="settings-field settings-field-wide credential-panel">
              <label for="settings-api-key">Provider API key</label>
              <p class="fieldset-note">{{ credentialLabel(currentCredentialStatus()) }}</p>
              <input
                id="settings-api-key"
                v-model="apiKey"
                class="settings-input"
                type="password"
                autocomplete="off"
                placeholder="Stored in the OS credential manager, not SQLite"
              />
              <div class="credential-actions">
                <button type="button" :disabled="savingCredential" @click="saveApiKey">
                  {{ savingCredential ? 'Saving key...' : 'Save API key' }}
                </button>
                <button type="button" :disabled="savingCredential" @click="removeApiKey">
                  Remove stored key
                </button>
              </div>
            </div>
          </div>
        </fieldset>

        <fieldset class="settings-fieldset" :disabled="loading">
          <legend>Redaction</legend>
          <p class="fieldset-note">
            Applied before any hosted provider transmission. Local analysis is unaffected.
          </p>
          <div class="settings-toggle-list">
            <label class="settings-toggle">
              <input v-model="redactEmployer" type="checkbox" />
              <span>Redact employer names</span>
            </label>
            <label class="settings-toggle">
              <input v-model="redactClearance" type="checkbox" />
              <span>Redact security clearance details</span>
            </label>
          </div>
          <div class="settings-field">
            <label for="settings-redaction-terms">Additional redaction terms</label>
            <input
              id="settings-redaction-terms"
              v-model="redactionTerms"
              class="settings-input"
              type="text"
              maxlength="1200"
              placeholder="Comma-separated names, projects, or identifiers"
            />
          </div>
        </fieldset>

        <fieldset class="settings-fieldset" :disabled="loading">
          <legend>Output and provider limits</legend>
          <div class="settings-grid">
            <div class="settings-field">
              <label for="settings-export-format">Default export format</label>
              <select id="settings-export-format" v-model="defaultExportFormat">
                <option value="">JSON</option>
                <option value="markdown">Markdown</option>
              </select>
            </div>
            <div class="settings-field">
              <label for="settings-max-tokens">Max total tokens</label>
              <input
                id="settings-max-tokens"
                v-model="maxTotalTokens"
                class="settings-input"
                type="number"
                min="1"
                max="1000000"
                placeholder="1 - 1,000,000"
              />
            </div>
            <div class="settings-field">
              <label for="settings-structured-output">Structured output mode</label>
              <select id="settings-structured-output" v-model="structuredOutputMode">
                <option value="">JSON Schema</option>
                <option value="json-object">JSON object</option>
              </select>
            </div>
            <div class="settings-field">
              <label for="settings-max-cost">Max cost (USD)</label>
              <input
                id="settings-max-cost"
                v-model="maxCostUsd"
                class="settings-input"
                type="number"
                min="0"
                max="1000"
                step="0.01"
                placeholder="Requires rates"
              />
            </div>
            <div class="settings-field">
              <label for="settings-input-rate">Input rate (micro USD / 1M tokens)</label>
              <input
                id="settings-input-rate"
                v-model="inputMicroUsdPerMillionTokens"
                class="settings-input"
                type="number"
                min="0"
                max="1000000000"
                placeholder="Required for cost cap"
              />
            </div>
            <div class="settings-field">
              <label for="settings-output-rate">Output rate (micro USD / 1M tokens)</label>
              <input
                id="settings-output-rate"
                v-model="outputMicroUsdPerMillionTokens"
                class="settings-input"
                type="number"
                min="0"
                max="1000000000"
                placeholder="Required for cost cap"
              />
            </div>
            <div class="settings-field">
              <label for="settings-timeout">Provider timeout (ms)</label>
              <input
                id="settings-timeout"
                v-model="providerTimeoutMs"
                class="settings-input"
                type="number"
                min="1000"
                max="300000"
                placeholder="1,000 - 300,000"
              />
            </div>
          </div>
        </fieldset>

        <footer class="form-footer">
          <p class="local-assurance">
            <span aria-hidden="true">&bull;</span>
            Database: <code>{{ databasePath }}</code>
          </p>
          <PrimaryButton :disabled="saving || loading">
            {{ saving ? 'Saving...' : 'Save settings' }}
          </PrimaryButton>
        </footer>
      </form>

      <p v-if="notice" class="parse-warnings" role="status">{{ notice }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
  </main>
</template>
