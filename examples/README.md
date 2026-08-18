# Examples

These examples use only fictional fixture data and can be run from the repository root.

## Deterministic JSON

```powershell
pnpm exec roleproof analyze `
  --resume fixtures/phase-1/strong-match/resume.txt `
  --job fixtures/phase-1/strong-match/job.txt `
  --no-ai `
  --no-store `
  --format json `
  --stdout
```

## Piped Job Text

```powershell
Get-Content fixtures/phase-1/strong-match/job.txt -Raw | pnpm exec roleproof analyze `
  --resume fixtures/phase-1/strong-match/resume.txt `
  --stdin-job `
  --no-ai `
  --no-store `
  --format json `
  --stdout
```

## Batch Manifest

```powershell
pnpm exec roleproof analyze `
  --manifest examples/batch-manifest.json `
  --no-ai `
  --no-store `
  --format json `
  --stdout
```

## Local Automation Request

Start the local server in one terminal:

```powershell
pnpm exec roleproof serve
```

Send a deterministic no-store automation request from another terminal:

```powershell
Invoke-RestMethod http://localhost:4173/api/automation/analyze `
  -Method Post `
  -ContentType 'application/json' `
  -InFile examples/automation-request.json
```
