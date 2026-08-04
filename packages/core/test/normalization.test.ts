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
    ['ReactJS', 'React'],
    ['Mongo', 'MongoDB'],
    ['Google Cloud Platform', 'GCP'],
    ['Microsoft Azure', 'Azure'],
    ['Apache Kafka', 'Kafka'],
    ['o11y', 'Observability'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeSkillName(input, DEFAULT_NORMALIZATION_DATA.aliases)).toBe(expected);
  });

  it('does not match Java inside JavaScript', () => {
    const mentions = extractSkillMentions(
      'Built JavaScript services with Node.js.',
      DEFAULT_NORMALIZATION_DATA.aliases,
    );

    expect(mentions.map((mention) => mention.canonicalName)).toEqual(['JavaScript', 'Node.js']);
  });

  it('extracts expanded taxonomy mentions in stable text order', () => {
    const mentions = extractSkillMentions(
      'Used Python, Redis, and Terraform on Azure.',
      DEFAULT_NORMALIZATION_DATA.aliases,
    );

    expect(mentions.map((mention) => mention.canonicalName)).toEqual([
      'Python',
      'Redis',
      'Terraform',
      'Azure',
    ]);
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

  it('requires case-sensitive Go syntax while still accepting Golang', () => {
    expect(
      extractSkillMentions(
        'Built workflows that go from intake to delivery.',
        DEFAULT_NORMALIZATION_DATA.aliases,
      ).map((mention) => mention.canonicalName),
    ).not.toContain('Go');
    expect(
      extractSkillMentions(
        'Built services with Go and Golang.',
        DEFAULT_NORMALIZATION_DATA.aliases,
      ).map((mention) => mention.canonicalName),
    ).toContain('Go');
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
