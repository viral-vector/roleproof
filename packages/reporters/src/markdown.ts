import { AnalysisResultSchema, type AnalysisResult, type EvidenceMatch } from '@roleproof/shared';

function renderMatch(match: EvidenceMatch): string {
  const evidence =
    match.evidenceIds.length === 0
      ? 'No evidence cited'
      : `Evidence: ${match.evidenceIds.map((id) => `\`${id}\``).join(', ')}`;
  return `- \`${match.requirementId}\` [${match.classification}] - ${evidence}. ${match.explanation}`;
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
      analysis.hardBlockers.map((blocker) => `- **Blocker:** ${blocker}`),
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
        (requirement) => `- \`${requirement.id}\` [${requirement.importance}] ${requirement.text}`,
      ),
      'No missing requirement was identified.',
    ),
    '',
    '## Unsupported or Risky Claims',
    '',
    renderLines(
      analysis.unsupportedClaims.map(
        (claim) => `- [${claim.classification}] ${claim.text} ${claim.explanation}`,
      ),
      'No unsupported claim warning was generated.',
    ),
    '',
    '## Safe Résumé Emphasis',
    '',
    renderLines(
      analysis.suggestedEmphasis.map(
        (suggestion) =>
          `- ${suggestion.text} Evidence: ${suggestion.evidenceIds.map((id) => `\`${id}\``).join(', ')}.`,
      ),
      'No additional emphasis was generated.',
    ),
    '',
    '## Suggested Additions Requiring Confirmation',
    '',
    renderLines(
      analysis.suggestedAdditions.map(
        (suggestion) => `- [${suggestion.classification}] ${suggestion.text}`,
      ),
      'No addition requiring confirmation was generated.',
    ),
    '',
    '## Interview Talking Points',
    '',
    renderLines(
      analysis.interviewTopics.map((topic) => `- ${topic}`),
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
