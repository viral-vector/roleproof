import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NORMALIZATION_DATA,
  extractSkillMentions,
  findSkillRelationship,
  normalizeSkillName,
} from '../src/index.js';

describe('skill normalization', () => {
  it.each([
    ['Postgres', 'PostgreSQL'],
    ['K8s', 'Kubernetes'],
    ['TS', 'TypeScript'],
    ['RESTful API', 'REST API'],
    ['.NET Core', '.NET'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeSkillName(input, DEFAULT_NORMALIZATION_DATA.aliases)).toBe(expected);
  });

  it('uses token boundaries so JS does not match JSON', () => {
    const mentions = extractSkillMentions(
      'Built JSON APIs with TypeScript.',
      DEFAULT_NORMALIZATION_DATA.aliases,
    );

    expect(mentions.map((mention) => mention.canonicalName)).toContain('TypeScript');
    expect(mentions.map((mention) => mention.canonicalName)).not.toContain('JavaScript');
  });

  it('does not manufacture JavaScript evidence from the Node.js suffix', () => {
    const mentions = extractSkillMentions(
      'Built services with Node.js.',
      DEFAULT_NORMALIZATION_DATA.aliases,
    );

    expect(mentions.map((mention) => mention.canonicalName)).toEqual(['Node.js']);
  });

  it('deduplicates aliases of the same canonical skill in stable text order', () => {
    const mentions = extractSkillMentions(
      'TS and TypeScript with Postgres and PostgreSQL.',
      DEFAULT_NORMALIZATION_DATA.aliases,
    );

    expect(mentions.map((mention) => mention.canonicalName)).toEqual(['TypeScript', 'PostgreSQL']);
  });
});

describe('skill relationships', () => {
  it('returns the configured non-direct classification', () => {
    expect(
      findSkillRelationship('Docker', 'Kubernetes', DEFAULT_NORMALIZATION_DATA.relationships),
    ).toBe('partially-related');
    expect(
      findSkillRelationship('OAuth2', 'OpenID Connect', DEFAULT_NORMALIZATION_DATA.relationships),
    ).toBe('strongly-related');
  });

  it('does not reverse directed relationships or infer transitive matches', () => {
    expect(
      findSkillRelationship('Kubernetes', 'Docker', DEFAULT_NORMALIZATION_DATA.relationships),
    ).toBeUndefined();
    expect(
      findSkillRelationship('AKS', 'Containerization', DEFAULT_NORMALIZATION_DATA.relationships),
    ).toBeUndefined();
  });
});
