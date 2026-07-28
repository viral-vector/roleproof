# RoleProof — Local AI Build Specification

## Purpose

This document is the authoritative implementation specification for a local coding AI. Build RoleProof incrementally, phase by phase. Do not expand the scope beyond the active phase unless required to satisfy an acceptance criterion.

---

# 1. Mission

RoleProof is an open-source, local-first job-fit analysis platform for truthful technical applications.

It compares a candidate's résumé and career evidence against a job description, identifies supported qualifications, highlights gaps, flags unsupported claims, and produces structured application guidance.

RoleProof must work as:

- A CLI for developers and automation chains
- A local web UI for non-technical users
- A reusable TypeScript library
- A local HTTP API
- A future MCP/agent/CI integration point
- A foundation for a future hosted product

AI is optional. The base application must provide useful deterministic analysis without a local or hosted language model.

---

# 2. Product Goal

RoleProof must answer:

1. Is this role aligned with the candidate's real experience?
2. Which requirements have concrete supporting evidence?
3. Which requirements are missing, weak, adjacent, or ambiguous?
4. What can the candidate safely emphasize or add without exaggerating?
5. Should the candidate apply, stretch, skip, or manually review the role?

Never present the fit score as the probability of receiving an interview or offer.

---

# 3. Positioning

## RoleProof is

- An evidence-based job-fit analyzer
- A local-first developer tool
- A simple local application for non-technical users
- An automation-friendly engine
- An optional AI-assisted application-planning tool

## RoleProof is not

- A mass-application bot
- A résumé fabrication tool
- An automatic applicant
- A guaranteed ATS optimizer
- A perfect ghost-job detector
- A general-purpose job board

Core positioning:

> Fewer applications. Better verified roles. Truthful tailoring.

---

# 4. Product Principles

## 4.1 Truth before optimization

Every proposed claim must be classified as:

- `direct`
- `strongly-related`
- `partially-related`
- `unsupported`
- `unknown`
- `requires-user-confirmation`

Never convert adjacent experience into direct experience.

## 4.2 Local-first

The default installation must not require:

- A cloud account
- An external database
- A hosted RoleProof account
- A queue
- A paid AI provider

## 4.3 AI optional

Supported modes will eventually include:

- `none`
- `openai`
- `anthropic`
- `ollama`
- `lmstudio`
- `openai-compatible`

## 4.4 Explainable output

Every score must identify:

- Positive evidence
- Missing evidence
- Adjacent evidence
- Eligibility blockers
- Score contributions
- Confidence

## 4.5 Machine-readable interfaces

Every major CLI operation must support JSON output suitable for:

- Shell scripts
- Agent chains
- CI pipelines
- MCP servers
- Desktop wrappers
- Browser extensions
- Future SaaS services

## 4.6 Progressive complexity

Do not require PostgreSQL, Redis, graph databases, vector databases, or cloud infrastructure for the local MVP.

---

# 5. Technology Stack

- **Language:** TypeScript
- **Runtime:** Node.js 22+
- **Package manager:** pnpm workspaces
- **CLI:** Commander.js
- **Local API:** Fastify
- **Web UI:** Vue + Vite
- **Validation:** Zod
- **Phase 2 storage:** SQLite using Drizzle ORM or Kysely
- **Search:** SQLite FTS5
- **Testing:** Vitest + Playwright
- **Packaging:** npm package and Docker image

Future hosted deployment may add PostgreSQL and queues, but only in a later phase.

---

# 6. High-Level Architecture

```text
                    ┌──────────────────────┐
                    │ Local Web UI         │
                    │ Vue + Vite           │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │ Local HTTP API       │
                    │ Fastify              │
                    └──────────┬───────────┘
                               │
┌─────────────────┐   ┌────────▼───────────┐   ┌──────────────────────┐
│ CLI             │──▶│ RoleProof Core     │◀──│ TypeScript Library   │
│ Commander.js    │   │ Analysis Engine    │   │ Public API           │
└─────────────────┘   └────────┬───────────┘   └──────────────────────┘
                               │
              ┌────────────────┼─────────────────┐
              │                │                 │
     ┌────────▼──────┐ ┌───────▼───────┐ ┌─────▼────────────┐
     │ Parsers       │ │ AI Providers  │ │ Reporters        │
     │ Text/PDF/HTML │ │ Optional      │ │ JSON/Markdown    │
     └───────────────┘ └───────────────┘ └──────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │ Storage Repository  │
                    │ SQLite in Phase 2   │
                    └──────────────────────┘
```

---

# 7. Repository Structure

```text
roleproof/
├── apps/
│   ├── cli/
│   ├── server/
│   └── web/
├── packages/
│   ├── core/
│   ├── parsers/
│   ├── providers/
│   ├── storage/
│   ├── reporters/
│   └── shared/
├── data/
│   ├── skill-aliases.json
│   ├── skill-relationships.json
│   └── ats-domains.json
├── examples/
├── fixtures/
├── docs/
├── .github/workflows/
├── Dockerfile
├── LICENSE
├── CONTRIBUTING.md
├── README.md
└── pnpm-workspace.yaml
```

Keep all business logic outside CLI handlers and Vue components.

---

# 8. Core Domain Types

Define Zod schemas first, then derive TypeScript types.

```ts
interface CandidateProfile {
  id: string;
  name?: string;
  targetTitles: string[];
  preferredLocations: string[];
  remotePreference?: "remote" | "hybrid" | "onsite" | "any";
  targetSalaryMin?: number;
  targetSalaryMax?: number;
  workAuthorization?: string;
  createdAt: string;
  updatedAt: string;
}
```

```ts
interface CareerEvidence {
  id: string;
  profileId: string;
  category:
    | "skill"
    | "project"
    | "responsibility"
    | "achievement"
    | "domain"
    | "leadership";
  name: string;
  normalizedName?: string;
  description: string;
  employer?: string;
  project?: string;
  startDate?: string;
  endDate?: string;
  sourceDocumentId: string;
  sourceText?: string;
  confidence: "explicit" | "inferred" | "user-confirmed";
}
```

```ts
interface JobRequirement {
  id: string;
  category:
    | "language"
    | "framework"
    | "database"
    | "infrastructure"
    | "domain"
    | "leadership"
    | "education"
    | "location"
    | "authorization"
    | "clearance"
    | "license"
    | "other";
  text: string;
  normalizedName?: string;
  importance: "required" | "preferred" | "contextual";
  yearsRequested?: number;
}
```

```ts
interface EvidenceMatch {
  requirementId: string;
  evidenceIds: string[];
  classification:
    | "direct"
    | "strongly-related"
    | "partially-related"
    | "unsupported"
    | "unknown"
    | "requires-user-confirmation";
  score: number;
  explanation: string;
}
```

```ts
interface AnalysisResult {
  schemaVersion: "1.0";
  id: string;
  profileId?: string;
  resumeDocumentId?: string;
  jobId?: string;
  overallScore: number;
  recommendation: "apply" | "stretch" | "skip" | "manual-review";
  confidence: number;
  hardBlockers: string[];
  matchedRequirements: EvidenceMatch[];
  missingRequirements: JobRequirement[];
  unsupportedClaims: UnsupportedClaim[];
  suggestedEmphasis: Suggestion[];
  suggestedAdditions: Suggestion[];
  interviewTopics: string[];
  generatedAt: string;
  metadata: AnalysisMetadata;
}
```

Every AI-generated recommendation must reference evidence IDs or be labeled unsupported/requires confirmation.

---

# 9. Deterministic Engine

The no-AI engine is mandatory and must:

- Parse résumé text
- Parse job-description text
- Extract technologies and responsibilities
- Identify required and preferred qualifications
- Normalize aliases
- Match exact skills
- Match related skills
- Detect eligibility blockers
- Compare salary ranges when available
- Produce an explainable score
- Generate Markdown
- Generate versioned JSON

## Skill aliases

Store in `data/skill-aliases.json`.

Examples:

```text
Postgres       -> PostgreSQL
K8s            -> Kubernetes
JS             -> JavaScript
TS             -> TypeScript
.NET Core      -> .NET
ASP.NET MVC    -> ASP.NET
GitLab CI      -> CI/CD
RESTful API    -> REST API
Graph DB       -> Graph database
```

## Related skills

Store in `data/skill-relationships.json`.

Examples:

```text
OAuth2        <-> OpenID Connect
AKS           -> Kubernetes
K3s           -> Kubernetes
MySQL         -> Relational database
PostgreSQL    -> Relational database
SQL Server    -> Relational database
SurrealDB     -> Graph database
SurrealDB     -> Document database
Express       -> Node.js backend
Laravel       -> PHP backend
ASP.NET MVC   -> .NET backend
Docker        -> Containerization
GitLab CI     -> CI/CD
```

A related skill must never be reported as a direct match.

---

# 10. Scoring

## Weights

- Required technical skills: 35%
- Relevant responsibilities: 20%
- Seniority and leadership: 15%
- Domain experience: 10%
- Infrastructure and delivery: 10%
- Preferred qualifications: 5%
- Eligibility and logistics: 5%

## Match values

```text
direct                     = 1.00
strongly-related           = 0.75
partially-related          = 0.40
unknown                    = 0.00
unsupported                = 0.00
requires-user-confirmation = 0.00
```

## Hard blockers

- Work-authorization mismatch
- Mandatory clearance mismatch
- Mandatory license mismatch
- Explicit location mismatch
- Compensation maximum below the user's minimum
- Mandatory degree/certification mismatch

## Recommendation rules

### Apply

- Score >= 75
- No hard blocker
- Most mandatory requirements are directly or strongly supported

### Stretch

- Score 55–74
- No hard blocker
- Important requirements are adjacent or incomplete

### Skip

- Score below 55
- Or any hard blocker exists

### Manual review

- Parsing confidence is low
- Requirements conflict
- Job text is incomplete
- Required versus preferred cannot be determined safely

---

# 11. CLI Specification

## Main command

```bash
roleproof analyze \
  --resume ./resume.pdf \
  --job ./job-description.txt
```

## Options

```text
--resume <path>
--job <path-or-url>
--stdin-job
--format markdown|json|both
--out <directory>
--stdout
--no-ai
--provider <provider>
--model <model>
--base-url <url>
--profile <profile-id>
--target-salary-min <number>
--target-salary-max <number>
--location <value>
--remote-preference <remote|hybrid|onsite|any>
--db <sqlite-path>
--no-store
```

## Planned commands

```bash
roleproof --version
roleproof init
roleproof analyze
roleproof profile create
roleproof profile show
roleproof profile evidence add
roleproof report show
roleproof history
roleproof search
roleproof providers list
roleproof providers test
roleproof data purge
roleproof serve
```

## Automation requirements

- Support non-interactive execution
- Use stdout for normal output
- Use stderr for errors
- In `--json` mode, stdout must contain JSON only
- Return documented exit codes

## Exit codes

```text
0   Success
1   General failure
2   Invalid arguments
3   File or parsing error
4   AI provider error
5   Storage error
10  Analysis succeeded with a hard eligibility blocker
```

---

# 12. Output Contracts

## JSON

```json
{
  "schemaVersion": "1.0",
  "analysis": {}
}
```

Do not make breaking changes within `1.x`.

## Markdown

```markdown
# RoleProof Analysis

## Role
## Recommendation
## Eligibility
## Overall Fit
## Strong Matches
## Partial Matches
## Missing Requirements
## Unsupported or Risky Claims
## Safe Résumé Emphasis
## Suggested Additions Requiring Confirmation
## Interview Talking Points
## Analysis Metadata
```

Every recommendation must identify supporting résumé evidence.

---

# 13. SQLite Design — Phase 2

Default database:

```text
~/.roleproof/roleproof.db
```

Tables:

- `profiles`
- `documents`
- `career_evidence`
- `jobs`
- `job_requirements`
- `analyses`
- `provider_calls`
- `settings`

Use FTS5 for résumé text, job text, evidence descriptions, and report text.

Store structured parser and analysis output in JSON fields where practical.

---

# 14. AI Provider Architecture — Phase 3

```ts
interface AIProvider {
  id: string;
  analyzeRequirements(input: RequirementAnalysisInput): Promise<RequirementAnalysisOutput>;
  mapEvidence(input: EvidenceMappingInput): Promise<EvidenceMappingOutput>;
  suggestApplicationChanges(input: ApplicationSuggestionInput): Promise<ApplicationSuggestionOutput>;
  healthCheck(): Promise<ProviderHealth>;
}
```

AI may:

- Interpret ambiguous requirements
- Identify related experience
- Explain fit
- Suggest truthful emphasis
- Generate interview talking points
- Generate cover-letter angles

AI must not:

- Add unsupported experience
- Modify the career-evidence store without confirmation
- Override deterministic hard blockers
- Return unvalidated free-form output

Reject provider output that fails schema validation.

Before sending data to a hosted provider, show the provider, model, destination type, and redaction state.

---

# 15. Local Web UI — Phase 4

Launch:

```bash
roleproof serve
```

Default URL:

```text
http://localhost:4173
```

Required screens:

## Analyze

- Upload résumé
- Paste job description
- Optional job URL
- Select deterministic or AI-enhanced mode
- Select provider
- Run analysis

## Results

- Recommendation
- Fit score
- Confidence
- Eligibility blockers
- Strong matches
- Partial matches
- Missing requirements
- Unsupported claims
- Safe résumé emphasis
- Suggestions requiring confirmation
- Interview topics
- Export JSON/Markdown

## History

- Search by company, title, skill, or recommendation
- Open report
- Delete report

## Settings

- Provider configuration
- Model
- Database location
- Redaction
- Output defaults
- Cost/token limits

No account or cloud dependency is allowed in the local product.

---

# 16. Job URL Analysis — Phase 5

Classify user-supplied URLs as:

- Official employer page
- Official ATS page
- Recruiter listing
- Aggregator listing
- Unknown source
- Removed/unavailable page

Recognize common ATS providers:

- Greenhouse
- Lever
- Workday
- Ashby
- Paylocity
- Rippling
- JazzHR
- SmartRecruiters

Never guarantee that a role is not a ghost job.

Allowed language:

- Official source detected
- Listing appears active
- Aggregator-only source detected
- Source could not be verified
- Page appears removed
- Listing status is uncertain

---

# 17. Privacy and Security

Default behavior:

- Local storage only
- No telemetry by default
- No automatic remote upload
- No account required
- No sensitive content in logs
- No plaintext API keys in application records

Key storage priority:

1. OS credential manager
2. Environment variables
3. Restricted local configuration file

Optional redaction:

- Email
- Phone
- Address
- Confidential employer names
- Clearance details
- User-selected terms

Data deletion:

```bash
roleproof data purge
```

---

# 18. Testing

## Unit tests

- Alias normalization
- Related-skill mapping
- Requirement extraction
- Scoring
- Hard blockers
- Recommendation rules
- Markdown rendering
- JSON schema validation
- Provider adapters

## Fictional fixtures

Create at least:

1. Strong match
2. Stretch match
3. Clear mismatch
4. Location blocker
5. Sponsorship blocker
6. Clearance blocker
7. Seniority mismatch
8. Ambiguous role
9. Adjacent but non-equivalent skills
10. Missing salary
11. Compensation below target
12. Low-confidence parsing

## Integration tests

- CLI to JSON
- CLI to Markdown
- CLI to SQLite
- PDF parser to core
- Provider mock
- Deterministic fallback
- Local API to core

## End-to-end tests

Playwright must cover:

1. Start local server
2. Open UI
3. Upload fictional résumé
4. Paste fictional job description
5. Run deterministic analysis
6. View results
7. Download Markdown
8. Download JSON

CI must never require a paid API.

---

# 19. Phased Build Plan

## Phase 0 — Foundation

### Deliverables

- pnpm monorepo
- TypeScript strict mode
- CLI package
- Core package
- Shared schemas
- Parsers package
- Reporters package
- ESLint
- Prettier
- Vitest
- GitHub Actions
- README
- LICENSE
- CONTRIBUTING
- Architecture document

### Acceptance criteria

- `pnpm install` succeeds
- `pnpm test` succeeds
- `pnpm lint` succeeds
- CLI prints help/version
- CI runs on Windows, Linux, and macOS

---

## Phase 1 — Deterministic CLI MVP

### Scope

- Plaintext résumé input
- Plaintext job input
- PDF résumé extraction
- Skill normalization
- Requirement extraction
- Exact and related matching
- Hard blockers
- Explainable scoring
- JSON output
- Markdown output

### Command

```bash
roleproof analyze \
  --resume resume.pdf \
  --job job.txt \
  --no-ai \
  --format both
```

### Acceptance criteria

- Cross-platform
- Stable schema-valid JSON
- Readable Markdown
- Direct and related experience are distinguished
- Eligibility blockers work
- At least 10 fictional fixtures pass
- No interview probability claim

### Release

`v0.1.0`

This is the first résumé-worthy release.

---

## Phase 2 — SQLite and Career Evidence

### Scope

- SQLite adapter
- Migrations
- Profiles
- Multiple résumé documents
- Career evidence
- Evidence editing
- Analysis history
- FTS5
- Duplicate-file detection
- Data purge

### Acceptance criteria

- Profiles and evidence persist locally
- Every match can identify source evidence
- History is searchable
- Duplicate files are detected
- All data can be deleted

### Release

`v0.2.0`

---

## Phase 3 — Optional AI Providers

### Scope

- Provider interface
- OpenAI adapter
- OpenAI-compatible adapter
- Ollama documentation
- LM Studio documentation
- Structured output validation
- Health checks
- Token/cost tracking
- Privacy warning
- Deterministic fallback

### Acceptance criteria

- Full functionality remains under `--no-ai`
- Provider failures degrade gracefully
- Every AI recommendation references evidence
- Invalid output is rejected
- Hard blockers cannot be overridden by AI

### Release

`v0.3.0`

---

## Phase 4 — Local Web UI

### Scope

- `roleproof serve`
- Fastify API
- Vue/Vite UI
- Upload résumé
- Paste job description
- Run analysis
- Show results
- Export JSON/Markdown
- History
- Settings

### Acceptance criteria

- Complete workflow without terminal commands
- No account/cloud requirement
- AI-generated content is labeled
- Core logic is shared with CLI
- Playwright tests pass

### Release

`v0.4.0`

---

## Phase 5 — Job URL Source Analysis

### Scope

- Fetch URL
- Extract job text
- Detect ATS
- Classify source
- Detect removed pages
- Store source/retrieval time

### Release

`v0.5.0`

---

## Phase 6 — Automation and Integrations

### Scope

- stdin support
- Batch analysis
- Local HTTP API
- MCP server
- GitHub Action
- Plugin API
- Docker image
- Webhook output

Example:

```bash
cat job.txt |
  roleproof analyze \
  --resume resume.pdf \
  --stdin-job \
  --json |
  jq '.analysis.recommendation'
```

### Release

`v0.6.0`

---

## Phase 7 — Hosted and Team Architecture

Only after real local users exist:

- PostgreSQL adapter
- Authentication
- Organization workspaces
- RBAC
- Queue processing
- Usage metering
- Audit logging
- Object storage
- Hosted provider proxy

---

# 20. MVP Non-Goals

Do not add to `v0.1.0`:

- Accounts
- Billing
- Automatic applications
- Job-board scraping
- Browser extension
- Recruiter outreach
- Cover-letter generation
- DOCX résumé editing
- Cloud sync
- Vector database
- Graph database
- PostgreSQL
- Redis
- Team collaboration
- Salary analytics
- Interview simulation
- Automatic résumé rewriting

---

# 21. Demo Fixture

Create a fictional candidate with:

- Node.js
- TypeScript
- PostgreSQL
- REST APIs
- Docker
- AWS
- OAuth2
- Team leadership

Create a fictional role requiring:

- Go
- Kubernetes
- PostgreSQL
- GraphQL
- OAuth2
- Five years of backend experience

Expected output:

- Direct: PostgreSQL
- Direct: OAuth2
- Direct: backend experience
- Direct: leadership
- Related: Docker to containerization
- Partial: Docker/AWS to Kubernetes
- Missing: direct Go
- Missing: direct GraphQL
- Recommendation: `stretch`
- Warning: do not claim production Go or GraphQL experience

---

# 22. First Release Checklist

- [ ] CLI installs successfully
- [ ] CLI help documented
- [ ] Windows CI passes
- [ ] Linux CI passes
- [ ] macOS CI passes
- [ ] Fictional fixtures included
- [ ] No real résumé data in repository
- [ ] JSON schema documented
- [ ] Markdown readable
- [ ] Scoring documented
- [ ] Privacy documented
- [ ] AI not required
- [ ] At least 10 fixture scenarios pass
- [ ] Demo GIF or terminal recording exists
- [ ] Issue templates included
- [ ] License included
- [ ] Contributing guide included

---

# 23. Required Implementation Order

1. Create pnpm monorepo.
2. Add shared Zod schemas.
3. Add core analysis interfaces.
4. Add CLI shell.
5. Add plaintext résumé input.
6. Add plaintext job input.
7. Add skill aliases.
8. Add related-skill mappings.
9. Add deterministic requirement extraction.
10. Add evidence matching.
11. Add hard blockers.
12. Add explainable scoring.
13. Add JSON reporter.
14. Add Markdown reporter.
15. Add PDF extraction.
16. Add fictional fixtures.
17. Add cross-platform CI.
18. Publish `v0.1.0`.
19. Add SQLite.
20. Add career evidence profiles.
21. Add optional AI providers.
22. Add local web UI.
23. Add job URL analysis.
24. Add automation integrations.

Do not wait for the UI before publishing the CLI.

---

# 24. Local Coding AI Rules

1. Work on one phase at a time.
2. Do not silently add later-phase features.
3. Keep business logic outside CLI and React components.
4. Define Zod schemas before handlers.
5. Write tests before declaring a phase complete.
6. Use fictional test data only.
7. Keep AI optional.
8. Never let AI create unsupported career evidence.
9. Maintain deterministic no-AI output for identical inputs.
10. Preserve stable JSON contracts.
11. Keep commands non-interactive when required flags are provided.
12. Keep JSON stdout free of logs or decorations.
13. Keep sensitive content out of logs.
14. Document every environment variable.
15. Update README and architecture docs with every release.
16. Do not introduce PostgreSQL, Redis, queues, graph databases, or cloud services early.
17. Prefer simple code over framework-heavy abstractions.
18. Ask for clarification only if this specification directly contradicts itself.
19. Otherwise make the smallest decision consistent with this document.
20. At the end of each phase, report:
    - Completed features
    - Remaining limitations
    - Test results
    - Commands to run
    - Files changed
    - Recommended next phase

---

# 25. Phase 0 Prompt

```text
Build Phase 0 of RoleProof using ROLEPROOF_BUILD_SPEC.md as the authoritative specification.

Requirements:
- Create a pnpm TypeScript monorepo.
- Add apps/cli and packages/core, packages/shared, packages/parsers, and packages/reporters.
- Add strict TypeScript configuration.
- Add ESLint, Prettier, Vitest, and cross-platform GitHub Actions.
- Implement a CLI supporting --help and --version.
- Define initial Zod schemas for CandidateProfile, CareerEvidence, JobRequirement, EvidenceMatch, AnalysisResult, and AnalysisMetadata.
- Add README, LICENSE, CONTRIBUTING.md, and docs/architecture.md.
- Do not implement analysis, SQLite, AI providers, or the web UI yet.
- Use fictional data only.
- Run tests and report results.
```

---

# 26. Phase 1 Prompt

```text
Build Phase 1 of RoleProof using ROLEPROOF_BUILD_SPEC.md.

Requirements:
- Add roleproof analyze.
- Accept plaintext and PDF résumé files.
- Accept plaintext job-description files.
- Add deterministic skill aliases and related-skill mappings.
- Extract technical requirements and classify them as required, preferred, or contextual.
- Match résumé evidence as direct, strongly-related, partially-related, unsupported, or unknown.
- Implement hard eligibility blockers.
- Implement explainable scoring.
- Output schema-versioned JSON.
- Output Markdown using the specified report contract.
- Add --no-ai, --format, --out, --stdout, and --no-store.
- Do not add persistence, AI providers, web UI, job URL fetching, or cloud services.
- Add at least 10 fictional fixtures.
- Ensure Windows, Linux, and macOS tests pass.
- Report test results and known limitations.
```

---

# 27. Résumé Positioning

After `v0.1.0`:

> Built RoleProof, an open-source TypeScript CLI for evidence-based job-fit analysis, featuring résumé and job-description parsing, deterministic skill matching, explainable scoring, unsupported-claim detection, structured JSON output, and Markdown report generation.

After the UI and AI-provider releases:

> Developed RoleProof, an open-source TypeScript CLI and local web platform for truthful AI-assisted job-fit analysis, combining deterministic scoring, SQLite local-first storage, pluggable LLM providers, evidence-linked structured outputs, and automation-friendly APIs.

---

# 28. Permanent Product Direction

RoleProof must remain:

- Truthful
- Explainable
- Local-first
- Automation-friendly
- AI-optional
- Open-source
- Safe for sensitive career data
- Useful without a hosted service
