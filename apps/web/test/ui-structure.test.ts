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

  it('keeps truth classifications and blockers visible in analysis results', async () => {
    const view = await readClientFile('features/analyze/AnalyzeView.vue');

    expect(view).toContain('Matched evidence');
    expect(view).toContain('Missing requirements');
    expect(view).toContain('Unsupported claims');
    expect(view).toContain('Eligibility blockers');
    expect(view).toContain(':aria-busy="running"');
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
});
