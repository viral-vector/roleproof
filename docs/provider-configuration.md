# Provider Configuration

AI enhancement is optional. Omitting `--provider`, or passing `--no-ai`, runs only the deterministic
engine. Environment variables provide credentials but never select or activate a provider.

## OpenAI

Set `OPENAI_API_KEY`, choose a model, and explicitly confirm hosted transmission:

```powershell
$env:OPENAI_API_KEY = "your-key"
pnpm exec roleproof analyze `
  --resume fixtures/phase-1/strong-match/resume.txt `
  --job fixtures/phase-1/strong-match/job.txt `
  --provider openai `
  --model gpt-4.1-mini `
  --confirm-transmission `
  --format json `
  --stdout
```

OpenAI always uses the fixed Responses API endpoint, strict JSON Schema output, and `store: false`.
Custom OpenAI base URLs are rejected.

## Ollama

Start Ollama's OpenAI-compatible endpoint, ensure the model is installed, and use a loopback local
destination. A local API key is not required:

```powershell
pnpm exec roleproof providers test `
  --provider openai-compatible `
  --model llama3.2 `
  --destination local `
  --base-url http://127.0.0.1:11434/v1

pnpm exec roleproof analyze `
  --resume fixtures/phase-1/strong-match/resume.txt `
  --job fixtures/phase-1/strong-match/job.txt `
  --provider openai-compatible `
  --model llama3.2 `
  --destination local `
  --base-url http://127.0.0.1:11434/v1 `
  --structured-output-mode json-object `
  --stdout
```

Use `json-schema` when the selected model/server supports strict structured output; otherwise select
`json-object`. Both modes receive the same strict local Zod validation.

## LM Studio

Enable LM Studio's local OpenAI-compatible server, load a model, and use its displayed loopback
port, commonly `1234`:

```powershell
pnpm exec roleproof providers test `
  --provider openai-compatible `
  --model local-model-id `
  --destination local `
  --base-url http://127.0.0.1:1234/v1
```

The `--model` value must match an ID returned by the endpoint's `/models` response.

## Hosted Or Custom Compatible Endpoints

Set `ROLEPROOF_PROVIDER_API_KEY`, use an HTTPS base URL without embedded credentials, query, or
fragment, choose `hosted` or `custom`, and pass `--confirm-transmission`. RoleProof does not silently
fall back to OpenAI or any other endpoint.

## Privacy And Limits

Email, phone, and common address redaction are enabled by default. Optional controls are:

- `--redact-employer`
- `--redact-clearance`
- repeatable `--redact-term <text>`

Pattern redaction is best-effort. Add explicit terms for sensitive names or phrases that must not be
sent. The transmission preview is written to stderr before any career-data request.

Provider limits include `--provider-timeout-ms`, `--max-input-chars`, `--max-output-tokens`, and
`--max-total-tokens`. Cost enforcement requires all three of `--max-cost-usd`,
`--input-cost-per-million-usd`, and `--output-cost-per-million-usd`. If a provider omits usage data,
RoleProof rejects the enhancement because aggregate token limits cannot be verified.

Cost limits are enforced from provider-reported usage after each response and stop later calls. They
are not prepaid spending guarantees: the first completed request, or the request that crosses the
limit, may already have been billed. `--max-output-tokens` bounds requested output before transport.

Provider failure returns the unchanged deterministic report with exit code `4`. No partial AI
enhancement is published. Use `roleproof providers list` to inspect supported adapter types and
`roleproof providers test` to perform a health check without sending career data.
