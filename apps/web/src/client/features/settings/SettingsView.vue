<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { LocalSettings } from '@roleproof/shared';

import { getSettings, updateSettings } from '../../api/client.js';
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
const providerTimeoutMs = ref('');
const error = ref('');
const notice = ref('');
const loading = ref(true);
const saving = ref(false);

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
  providerTimeoutMs.value =
    loaded.providerTimeoutMs == null ? '' : String(loaded.providerTimeoutMs);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const response = await getSettings();
    databasePath.value = response.databasePath;
    applyLoaded(response.settings);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Settings are unavailable.';
  } finally {
    loading.value = false;
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
  payload.providerTimeoutMs =
    providerTimeoutMs.value === '' ? null : Number(providerTimeoutMs.value);

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
        <p>Stored in the local database. Nothing here is sent anywhere.</p>
      </header>

      <p v-if="loading" class="loading-note" role="status">Loading settings...</p>

      <form v-else class="settings-form" @submit.prevent="save">
        <fieldset class="settings-fieldset">
          <legend>AI enhancement</legend>
          <p class="fieldset-note">
            Optional. Deterministic analysis never requires a provider; these limits only apply when
            AI enhancement is enabled later.
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
              <input
                id="settings-model"
                v-model="model"
                class="settings-input"
                type="text"
                maxlength="255"
                placeholder="Required when a provider is selected"
              />
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
          </div>
        </fieldset>

        <fieldset class="settings-fieldset">
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

        <fieldset class="settings-fieldset">
          <legend>Output defaults</legend>
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
                max="10000000"
                placeholder="1 - 10,000,000"
              />
            </div>
            <div class="settings-field">
              <label for="settings-max-cost">Max cost (USD)</label>
              <input
                id="settings-max-cost"
                v-model="maxCostUsd"
                class="settings-input"
                type="number"
                min="0"
                max="10000"
                step="0.01"
                placeholder="0 - 10,000"
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
                max="3600000"
                placeholder="1,000 - 3,600,000"
              />
            </div>
          </div>
        </fieldset>

        <footer class="form-footer">
          <p class="local-assurance">
            <span aria-hidden="true">&bull;</span>
            Database: <code>{{ databasePath }}</code>
          </p>
          <PrimaryButton :disabled="saving">
            {{ saving ? 'Saving...' : 'Save settings' }}
          </PrimaryButton>
        </footer>
      </form>

      <p v-if="notice" class="parse-warnings" role="status">{{ notice }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
  </main>
</template>
