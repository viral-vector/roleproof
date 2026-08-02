import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const readClientFile = (relativePath: string) =>
  readFile(new URL(`../src/client/${relativePath}`, import.meta.url), 'utf8');

describe('local UI structure', () => {
  it('uses the RoleProof proof mark in the application brand', async () => {
    const shell = await readClientFile('components/AppShell.vue');

    expect(shell).toContain("import ProofMark from './ProofMark.vue'");
    expect(shell).toContain('<ProofMark class="brand-mark" />');
    expect(shell).toContain('class="brand-mark"');
  });

  it('keeps truth classifications and blockers visible in the shared analysis results', async () => {
    const results = await readClientFile('components/AnalysisResults.vue');

    expect(results).toContain('Missing requirements');
    expect(results).toContain('Unsupported claims');
    expect(results).toContain('Eligibility blockers');
    expect(results).toContain('Strong matches');
    expect(results).toContain('Partial matches');
    expect(results).toContain('Safe résumé emphasis');
    expect(results).toContain('Suggestions requiring confirmation');
    expect(results).toContain('Interview topics');
    expect(results).toContain('exportFormats');
    expect(results).toContain('AI-enhanced guidance');
    expect(results).toContain('Deterministic fallback');
    expect(results).toContain('Validated AI Output');
    expect(results).toContain('AI Requirement Interpretations');
  });

  it('renders the complete AI enhancement in results and downloads', async () => {
    const results = await readClientFile('components/AnalysisResults.vue');

    expect(results).toContain('AI Evidence Mappings');
    expect(results).toContain('AI Suggested Additions');
    expect(results).toContain('AI Interview Topics');
    expect(results).toContain('AI Cover-Letter Angles');
    expect(results).toContain('Provider Metadata');
    expect(results).toContain('aiEnhancement!.providerExecutions');
    expect(results).toContain('downloadAnalysis(props.response, format)');
  });

  it('orders export downloads by the saved default export format', async () => {
    const results = await readClientFile('components/AnalysisResults.vue');

    expect(results).toContain('getSettings');
    expect(results).toContain('orderedExportFormats');
    expect(results).toContain('export-button-primary');
    expect(results).toContain('Download {{ format === \'json\' ? \'JSON\' : \'Markdown\' }}');
  });

  it('keeps file input and analysis submission on the analyze screen only', async () => {
    const analyze = await readClientFile('features/analyze/AnalyzeView.vue');

    expect(analyze).toContain('type="file"');
    expect(analyze).toContain(
      'accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"',
    );
    expect(analyze).toContain('Selection stays in your browser until you run analysis.');
    expect(analyze).toContain('AI-enhanced analysis');
    expect(analyze).toContain('I confirm RoleProof may send redacted analysis inputs');
    expect(analyze).toContain('progress');
    expect(analyze).toContain('class="form-actions"');
    expect(analyze).toContain(':aria-busy="running"');
    expect(analyze).toContain('<AnalysisResults');
    expect(analyze).not.toContain('Eligibility blockers');
  });

  it('discloses the configured AI provider before transmission consent', async () => {
    const analyze = await readClientFile('features/analyze/AnalyzeView.vue');

    expect(analyze).toContain('getSettings');
    expect(analyze).toContain('updateSettings');
    expect(analyze).toContain('AI transmission disclosure');
    expect(analyze).toContain('Analysis provider');
    expect(analyze).toContain('Analysis model');
    expect(analyze).toContain('listProviderModels');
    expect(analyze).toContain('Load models');
    expect(analyze).not.toContain('<span>Provider destination</span>');
    expect(analyze).not.toContain('<span>Provider base URL</span>');
    expect(analyze).toContain('Apply provider settings');
    expect(analyze).toContain('providerSelectionDirty');
    expect(analyze).toContain('Provider settings changed. Review the updated disclosure');
    expect(analyze).toContain('Provider');
    expect(analyze).toContain('Model');
    expect(analyze).toContain('Destination');
    expect(analyze).toContain('Endpoint');
    expect(analyze).toContain('Redaction');
    expect(analyze).toContain('Redacted analysis inputs will leave this machine');
    expect(analyze).toContain('No AI provider is configured');
    expect(analyze).toContain('applyingProviderSettings');
    expect(analyze).toContain('!disclosureConfigured');
  });

  it('separates the landing hero from the analysis comparison workspace', async () => {
    const router = await readClientFile('app/router.ts');
    const analyze = await readClientFile('features/analyze/AnalyzeView.vue');
    const home = await readClientFile('features/home/HomeView.vue').catch(() => '');

    expect(router).toContain("import HomeView from '../features/home/HomeView.vue'");
    expect(router).toContain("{ path: '/', component: HomeView }");
    expect(router).not.toContain("{ path: '/', redirect: '/analyze' }");
    expect(home).toContain('<section class="hero"');
    expect(home).toContain('to="/analyze"');
    expect(analyze).not.toContain('<section class="hero"');
    expect(analyze).toContain('class="workspace"');
  });

  it('wires history list, history detail, and settings routes to real views', async () => {
    const router = await readClientFile('app/router.ts');

    expect(router).toContain("import HistoryView from '../features/history/HistoryView.vue'");
    expect(router).toContain(
      "import HistoryDetailView from '../features/history/HistoryDetailView.vue'",
    );
    expect(router).toContain("import SettingsView from '../features/settings/SettingsView.vue'");
    expect(router).toContain("{ path: '/history', component: HistoryView }");
    expect(router).toContain("{ path: '/history/:id', component: HistoryDetailView }");
    expect(router).toContain("{ path: '/settings', component: SettingsView }");
    expect(router).not.toContain('PlaceholderView');
  });

  it('history view searches stored analyses and can delete them', async () => {
    const history = await readClientFile('features/history/HistoryView.vue');

    expect(history).toContain('Search history');
    expect(history).toContain('listHistory');
    expect(history).toContain('deleteHistoryItem');
    expect(history).toContain(':to="`/history/${item.id}`"');
    expect(history).toContain('No stored analyses yet');
  });

  it('history detail view loads a stored analysis and can delete it', async () => {
    const detail = await readClientFile('features/history/HistoryDetailView.vue');

    expect(detail).toContain('getHistoryItem');
    expect(detail).toContain('deleteHistoryItem');
    expect(detail).toContain('<AnalysisResults');
    expect(detail).toContain('Analysis was not found');
    expect(detail).toContain('remains available for future analyses');
  });

  it('settings view reads and updates stored settings', async () => {
    const settings = await readClientFile('features/settings/SettingsView.vue');

    expect(settings).toContain('getSettings');
    expect(settings).toContain('updateSettings');
    expect(settings).toContain('databasePath');
    expect(settings).toContain('Redact employer names');
    expect(settings).toContain('defaultExportFormat');
    expect(settings).toContain('provider');
    expect(settings).toContain('getProviderCredentialStatus');
    expect(settings).toContain('listProviderModels');
    expect(settings).toContain('Load models');
    expect(settings).toContain('settings-model-select');
    expect(settings).toContain('Save API key');
    expect(settings).toContain('Remove stored key');
    expect(settings).toContain('structuredOutputMode');
    expect(settings).toContain('inputMicroUsdPerMillionTokens');
  });
});
