# Scoring

RoleProof's deterministic fit score describes support in supplied evidence. It is not an ATS
certainty, interview probability, hiring probability, or statement of employer intent.

## Canonical Weights

- Required technical skills: 35
- Relevant responsibilities: 20
- Seniority and leadership: 15
- Domain experience: 10
- Infrastructure and delivery: 10
- Preferred qualifications: 5
- Eligibility and logistics: 5

Each populated category divides its effective weight equally among its requirements. Empty
categories are excluded and populated categories are proportionally renormalized to 100. This
prevents a job from losing points merely because it does not mention a category. Contextual
requirements are not scored. Effective weights and points use deterministic six-decimal
fixed-point allocation, so contribution totals remain exactly auditable without exceeding 100 or
assigning residual weight to a configured zero-weight category.

## Match Values

- `direct`: 1
- `strongly-related`: 0.75
- `partially-related`: 0.4
- `unsupported`: 0
- `unknown`: 0
- `requires-user-confirmation`: 0

Aliases normalize to the same canonical skill and may produce a direct match. Configured
relationships can produce only strongly or partially related matches. Relationships are not
chained transitively. A supported match and score contribution must cite evidence IDs. Mandatory
requirements outside the version-controlled normalization data are retained but left unnormalized
and classified `unknown`; RoleProof does not claim that missing normalization proves missing
experience. Ambiguous short aliases (for example the Go language versus the English verb) are
matched case-sensitively, while their spelled-out forms stay case-insensitive. Explicit candidate-
context eligibility facts can produce direct eligibility support when category-specific comparison
confirms the required level or value. Each match includes at most 100 deterministically selected
evidence references to bound result size. Repeated requirements for the same skill and importance
retain the strictest requested duration. Requested experience ranges (`7-10 years`, `7 to 10
years`) are read at their minimum bound, so a range never claims more experience than the posting
demands. An explicit years-of-experience claim in evidence (`14+ years of TypeScript experience`)
can satisfy the requested duration when the claim names the same skill; year-only boundary dates
alone are never inferred as full durations. Analysis is bounded to 500 semantic requirements;
exceeding that limit lowers confidence and requires manual review.

## Recommendations

Recommendation precedence is:

1. Any explicit hard blocker produces `skip`.
2. Low parsing confidence, conflicting importance, no requirements, or an unknown mandatory
   requirement produces `manual-review`.
3. Score 75 or higher with at least 60% of mandatory requirements directly or strongly supported
   produces `apply`.
4. Score 55 or higher produces `stretch`.
5. Lower scores produce `skip`.

Hard blockers do not modify the fit score. Each result includes score contributions with the
requirement, classification, evidence IDs, applied weight, points awarded, and explanation.
Eligibility blockers use required requirements extracted from qualification sections. A blocker is
reported only when both the requirement and conflicting candidate fact are explicit.
