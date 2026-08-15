import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('RoleProof GitHub Action metadata', () => {
  it('defines a composite action that runs deterministic RoleProof analysis', async () => {
    const action = await readFile(resolve('action.yml'), 'utf8');

    expect(action).toContain('name: RoleProof Analyze');
    expect(action).toContain('using: composite');
    expect(action).toContain('roleproof analyze');
    expect(action).toContain('--no-ai');
    expect(action).toContain('resume-path');
    expect(action).toContain('job-path');
  });
});
