import {
  EnhancedAnalysisEnvelopeSchema,
  AnalysisResultSchema,
  type AIEnhancement,
  type AnalysisResult,
  type EvidenceMatch,
} from '@roleproof/shared';

function text(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function renderMatch(match: EvidenceMatch): string {
  const evidence =
    match.evidenceIds.length === 0
      ? 'No evidence cited'
      : `Evidence: ${match.evidenceIds.map((id) => `\`${id}\``).join(', ')}`;
  return `- \`${match.requirementId}\` [${match.classification}] - ${evidence}. ${text(match.explanation)}`;
}

function renderLines(lines: string[], emptyMessage: string): string {
  return lines.length === 0 ? `- ${emptyMessage}` : lines.join('\n');
}

export function renderMarkdown(result: AnalysisResult): string {
  const analysis = AnalysisResultSchema.parse(result);
  const strongMatches = analysis.matchedRequirements.filter(
    (match) => match.classification === 'direct' || match.classification === 'strongly-related',
  );
  const partialMatches = analysis.matchedRequirements.filter(
    (match) => match.classification === 'partially-related',
  );
  const contributions = analysis.scoreContributions ?? [];

  const sections = [
    '# RoleProof Analysis',
    '',
    '## Role',
    '',
    `- Job ID: ${analysis.jobId === undefined ? 'Not provided' : `\`${analysis.jobId}\``}`,
    `- Resume document ID: ${analysis.resumeDocumentId === undefined ? 'Not provided' : `\`${analysis.resumeDocumentId}\``}`,
    '',
    '## Recommendation',
    '',
    `Recommendation: **${analysis.recommendation}**`,
    '',
    'This recommendation describes evidence-based fit and does not predict employer outcomes.',
    '',
    '## Eligibility',
    '',
    renderLines(
      analysis.hardBlockers.map((blocker) => `- **Blocker:** ${text(blocker)}`),
      'No hard eligibility blocker was detected from explicit supplied facts.',
    ),
    '',
    '## Overall Fit',
    '',
    `- Overall score: **${analysis.overallScore}/100**`,
    `- Confidence: **${Math.round(analysis.confidence * 100)}%**`,
    ...contributions.map(
      (contribution) =>
        `- \`${contribution.requirementId}\`: ${contribution.pointsAwarded}/${contribution.appliedWeight} points (${contribution.scoringCategory})`,
    ),
    '',
    '## Strong Matches',
    '',
    renderLines(strongMatches.map(renderMatch), 'No direct or strongly related match was found.'),
    '',
    '## Partial Matches',
    '',
    renderLines(partialMatches.map(renderMatch), 'No partial match was found.'),
    '',
    '## Missing Requirements',
    '',
    renderLines(
      analysis.missingRequirements.map(
        (requirement) =>
          `- \`${requirement.id}\` [${requirement.importance}] ${text(requirement.text)}`,
      ),
      'No missing requirement was identified.',
    ),
    '',
    '## Unsupported or Risky Claims',
    '',
    renderLines(
      analysis.unsupportedClaims.map(
        (claim) => `- [${claim.classification}] ${text(claim.text)} ${text(claim.explanation)}`,
      ),
      'No unsupported claim warning was generated.',
    ),
    '',
    '## Safe Résumé Emphasis',
    '',
    renderLines(
      analysis.suggestedEmphasis.map(
        (suggestion) =>
          `- ${text(suggestion.text)} Evidence: ${suggestion.evidenceIds.map((id) => `\`${id}\``).join(', ')}.`,
      ),
      'No additional emphasis was generated.',
    ),
    '',
    '## Suggested Additions Requiring Confirmation',
    '',
    renderLines(
      analysis.suggestedAdditions.map(
        (suggestion) => `- [${suggestion.classification}] ${text(suggestion.text)}`,
      ),
      'No addition requiring confirmation was generated.',
    ),
    '',
    '## Interview Talking Points',
    '',
    renderLines(
      analysis.interviewTopics.map((topic) => `- ${text(topic)}`),
      'No interview topic was generated.',
    ),
    '',
    '## Analysis Metadata',
    '',
    `- Analysis ID: \`${analysis.id}\``,
    `- Schema version: \`${analysis.schemaVersion}\``,
    `- Mode: \`${analysis.metadata.mode}\``,
    `- Engine version: \`${analysis.metadata.engineVersion}\``,
    `- Generated at: \`${analysis.generatedAt}\``,
    '',
  ];

  return sections.join('\n');
}

const evidenceList = (evidenceIds: readonly string[]): string =>
  evidenceIds.length === 0
    ? 'No evidence cited'
    : `Evidence: ${evidenceIds.map((id) => `\`${id}\``).join(', ')}`;

export function renderEnhancedMarkdown(result: AnalysisResult, enhancement: AIEnhancement): string {
  const envelope = EnhancedAnalysisEnvelopeSchema.parse({
    schemaVersion: '2.0',
    analysis: result,
    aiEnhancement: enhancement,
  });
  const ai = envelope.aiEnhancement;
  const suggestions = ai.applicationSuggestions;
  const executions = ai.providerExecutions;
  const sections = [
    renderMarkdown(envelope.analysis),
    '## AI Enhancement',
    '',
    'The deterministic score, recommendation, and blockers are unchanged by AI enhancement.',
    '',
    '## AI Requirement Interpretations',
    '',
    renderLines(
      ai.requirementAnalysis.requirements.map(
        (item) =>
          `- \`${item.requirementId}\` [baseline: ${item.baselineClassification}; AI interpretation: ${item.classification}] - ${evidenceList(item.evidenceIds)}. ${text(item.explanation)}`,
      ),
      'No AI requirement interpretation was generated.',
    ),
    '',
    '## AI Evidence Mappings',
    '',
    renderLines(
      ai.evidenceMapping.mappings.map(
        (item) =>
          `- \`${item.requirementId}\` [baseline: ${item.baselineClassification}; AI mapping: ${item.classification}] - ${evidenceList(item.evidenceIds)}. ${text(item.explanation)}`,
      ),
      'No AI evidence mapping was generated.',
    ),
    '',
    '## AI Suggested Emphasis',
    '',
    renderLines(
      suggestions.suggestedEmphasis.map(
        (item) =>
          `- [${item.classification}] ${text(item.text)} ${evidenceList(item.evidenceIds)}. ${text(item.explanation)}`,
      ),
      'No AI emphasis was generated.',
    ),
    '',
    '## AI Suggested Additions',
    '',
    renderLines(
      suggestions.suggestedAdditions.map(
        (item) =>
          `- [${item.classification}] ${text(item.text)} ${evidenceList(item.evidenceIds)}. ${text(item.explanation)}`,
      ),
      'No AI addition was generated.',
    ),
    '',
    '## AI Interview Topics',
    '',
    renderLines(
      suggestions.interviewTopics.map(
        (item) =>
          `- ${text(item.topic)} ${evidenceList(item.evidenceIds)}. ${text(item.rationale)}`,
      ),
      'No AI interview topic was generated.',
    ),
    '',
    '## AI Cover-Letter Angles',
    '',
    renderLines(
      suggestions.coverLetterAngles.map(
        (item) => `- ${text(item.text)} ${evidenceList(item.evidenceIds)}.`,
      ),
      'No AI cover-letter angle was generated.',
    ),
    '',
    '## Provider Metadata',
    '',
    ...executions.flatMap((execution) => [
      `- Operation: \`${execution.operation}\``,
      `- Provider/model: \`${execution.provider}\` / \`${execution.model}\``,
      `- Destination: \`${execution.destination}\``,
      `- Redaction applied: **${execution.manifest.redactionApplied ? 'yes' : 'no'}**`,
      `- Redaction replacements: ${execution.manifest.redactionSummary.replacementCount}`,
      `- Usage: input ${execution.usage.inputTokens ?? 'unknown'}, output ${execution.usage.outputTokens ?? 'unknown'}, total ${execution.usage.totalTokens ?? 'unknown'} tokens; cost ${execution.usage.costMicroUsd ?? 'unknown'} micro-USD`,
    ]),
    '',
    'AI enhancement does not predict interviews, hiring, or other employment outcomes.',
    '',
  ];
  return sections.join('\n');
}
