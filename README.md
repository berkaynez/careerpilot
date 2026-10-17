# CareerPilot

CareerPilot is a personal, AI-first job application agent. Phase 3A adds a real
tool-calling decision policy, agent runner, OpenAI-compatible Responses adapter,
durable spending ledger, and CLI to the existing loopback mocks and guarded
Playwright browser adapter. The single-page workflow is covered end to end with a
mocked LLM transport. A paid live-model run has not yet been performed.

## Setup

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run browser:install
npm run check
```

`npm test` runs offline unit tests with Node's test runner through `tsx`.
`npm run typecheck` checks the source and tests without emitting files.
Tests use Playwright's bundled Chromium. No API keys, AI model downloads, or paid
calls are required. Dependency and Chromium installation require network access;
all tests then run offline using only loopback servers.

## Local demo

```sh
npm run demo
```

Open `http://127.0.0.1:3000` manually to explore the three forms with fictional
data only. Use `PORT=3001 npm run demo` if port 3000 is occupied. Ctrl+C stops the
server and discards its in-memory submissions. Nothing is sent to a real employer.

- `/applications/single`: contact, education, project experience, required fields,
  and accuracy confirmation.
- `/applications/multi`: validated contact/qualifications steps, back navigation,
  review, and final confirmation.
- `/applications/dynamic`: employment-dependent employer question, delayed project
  question, and up to five repeatable work-history positions.

The browser adapter is exercised by `npm test`; the demo server does not run an
autonomous form-filling script. Tests contain explicit interactions and assertions,
not a production decision policy. Automated browser sessions always launch fresh
Chromium contexts and do not read personal browser profiles.

After manual submission, the page displays a run ID and receipt ID. Read
`/api/receipts/<runId>` on the same origin to independently check the server's
receipt. Invalid submissions produce no receipt. Identical retries reuse a receipt;
changed submissions for the same run return 409. Receipts contain metadata only.

## First live AI test (after approval)

Offline tests never need an API key and never call an AI provider. These commands
prepare an explicitly enabled **paid** run; run the final command only after approval:

```sh
npm ci
npm run browser:install
cp -n .env.example .env
chmod 600 .env
code .env
```

In `.env`, set `OPENAI_API_KEY` and `OPENAI_MODEL` explicitly. Select a model that
supports the Responses API, strict function tools, and input-token counting.
There is no default paid model and no automatic model/provider fallback.

Set `MODEL_INPUT_USD_PER_MILLION` and `MODEL_OUTPUT_USD_PER_MILLION` to the verified
standard USD rates for that exact model. Set `MODEL_PRICING_SOURCE` to the HTTPS
pricing source and `MODEL_PRICING_VERIFIED_ON` to the date you checked it (YYYY-MM-DD),
then set `MODEL_PRICING_VERIFIED=true`. Values are deliberately blank in the template;
the application validates the configuration and records your attestation, but does
not independently verify a provider's pricing page. No token prices are guessed.
Rates must be positive and support up to six decimal places. Cached-input discounts
are not assumed; all output usage, including reasoning tokens, is accounted for.

For this fictional exercise, explicitly set `MOCK_CONSENT_ACCURACY=true` and
`MOCK_CONSENT_SUBMIT=true` if you grant those consents. Otherwise the agent cannot
confirm accuracy or submit. Set `CAREERPILOT_ENABLE_PAID_CALLS=true` only when ready.
Leave `MONTHLY_BUDGET_USD=5`, or explicitly choose another positive limit up to $8.
`PER_RUN_BUDGET_USD` defaults to `0.10` and is a separate cap for each run ID.

Then run:

```sh
npm run agent
```

The CLI starts its **own** server on an ephemeral `127.0.0.1` port and always opens
`/applications/single`. It does not accept a real job URL or need `npm run demo`
running separately. It launches an isolated Chromium context, runs the LLM loop,
checks the independently stored receipt and confirmation UI, prints the outcome,
usage, estimated cost, monthly ledger summary, and log path, then closes resources.
Set `HEADLESS=false` to watch Chromium. Ctrl+C aborts the run.

Execution metadata is written to `.careerpilot/runs/<runId>.jsonl`. Inspect the log
path printed by the CLI, for example:

```sh
tail -n 30 .careerpilot/runs/*.jsonl
cat .careerpilot/budget.jsonl
```

Logs include chosen tool names, candidate fact IDs, action result codes, request
reservations, settled usage, and outcomes. They omit raw model output, answer text,
browser HTML, personal identifiers, and credentials. The state directory and `.env`
are Git-ignored. Do not change/delete the ledger to clear spending limits.

Other environment settings are listed in `.env.example`: input/output token caps,
action limit, run timeout, headless mode, state directory, and API base URL.
`OPENAI_BASE_URL` defaults to `https://api.openai.com/v1`. A compatible custom service
must support `/responses` **and** `/responses/input_tokens`, including strict tools.
The adapter does not fall back to Chat Completions or approximate token counting.
Provider requests have a 30-second timeout and never follow HTTP redirects or
automatically retry a failed network request. Never put a credential in a base URL.
Successful response bodies are read incrementally with a 1,000,000-byte limit.
Oversized bodies and aborted requests cancel the reader before consuming the rest.

Provider failures use fixed diagnostic codes for authentication, permissions,
missing endpoints/models, invalid requests, rate/quota limits, server errors,
network errors, timeouts/cancellation, oversized bodies, and invalid JSON/schema.
HTTP classifications follow the [official error guidance](https://developers.openai.com/api/docs/guides/error-codes).
A 429 is reported as a rate-or-quota limit without guessing which from its body.
Errors carry only a code, preflight/generation stage, and optional HTTP status;
logs record the code, never raw responses, transport errors, headers, or credentials.
Classifying a failure does not refund its reservation or enable automatic retries.

## Architecture

The intended loop is observation → LLM tool call → deterministic validation →
Playwright execution → fresh observation. The LLM interprets questions and chooses
actions. Deterministic code enforces references, policy, privacy, budgets, and
execution boundaries; it does not map specific forms to candidate answers.

- `src/contracts.ts`: agent decisions, observations, browser executor, submission
  verifier, outcomes, and metadata-only event sink. `LLMDecisionPolicy` implements
  `DecisionPolicy`; no deterministic production policy exists.
- `src/profile.ts`: fictional, authored facts with IDs and provenance. Personal
  identifiers live separately in `PersonalData`, addressed by local references.
- `src/policy.ts`: application preferences, country salary policies, exact factual
  claim checks, explicit consent, and country-specific work authorization checks.
- `src/llm.ts`: provider-neutral messages, tools, responses, usage, model
  configuration, and validation. OpenAI and Ollama configuration slots are present;
  Gemini and DeepSeek can implement the same interface later.
- `src/privacy.ts`: explicit cloud-context projection, removal of known personal
  values, and baseline email/phone redaction. Field values and raw HTML are omitted.
- `src/budget.ts`: configurable budgets, integer micro-USD accounting, conservative
  pre-request reservations, and per-run token/cost totals.
- `src/validation.ts`: local-origin, candidate-reference, action-count, consent,
  batch, target, and observation-freshness guards.
- `src/mocks/forms.ts`: accessible mock HTML, form interactions, and server-side
  field/conditional/history validation.
- `src/mocks/server.ts`: loopback-only HTTP server and independent receipt store;
  implements the existing `SubmissionVerifier` interface.
- `src/mocks/demo.ts`: local demo entry point.
- `src/browser/inspector.ts`: visible controls, native input types, labels, help,
  required status, options, errors, and navigation/submission effects.
- `src/browser/executor.ts`: isolated Chromium, network guard, validated action
  execution, action events, deadline/abort handling, and batch reinspection.
- `src/agent/tools.ts`: strict schemas and reference-only tool-to-action conversion.
- `src/agent/decision-policy.ts`: LLM-led decisions, on-demand fact disclosure,
  privacy filtering, progress summaries, and bounded invalid-call correction.
- `src/agent/runner.ts`: observe → reason → validate → execute → verify loop;
  enforces limits, submission readiness, and receipt matching.
- `src/providers/openai-compatible.ts`: injected HTTP transport, strict Responses
  tool calling, input preflight, token usage, and no network/model fallbacks.
- `src/persistent-budget.ts`: durable journal using the existing budget arithmetic
  and reservation logic, a $5 default stop, and short cross-process file locks.
- `src/config.ts`, `src/cli.ts`: environment configuration and local-only agent CLI.
- `src/events.ts`: metadata-only JSONL event sink.
- `tests/`: offline tests of the above boundaries and failure cases.

No job discovery, CV generation, Gmail, dashboard, model router, or other provider
adapter is implemented. The existing `LLMProvider` abstraction remains independent
of OpenAI for future Ollama, Gemini, or DeepSeek adapters.

## Candidate data and application policy

The fixture describes an invented candidate. "Verified" means checked against the
authored fictional source; it is not verification of a real person's credentials.
Unknown information stays absent. Identity and email are local references such as
`personal.email`; the browser executor resolves them locally without sending the values
to a model. Do not place personal identifiers in public candidate facts.

Application preferences are separate from facts and personal data. Consent is
denied unless a specific preference is explicitly true. Work authorization for one
country never implies authorization for another. The work-authorization guard is a
conservative eligibility check; future sponsored-job support needs an explicit
policy rather than assuming that missing authorization means sponsorship is possible.

Salary policies start empty. Add a country policy only after the user supplies its
country, currency, pay period, and gross-base minimum. A `null` minimum is explicitly
unset. Missing floors, mismatched currencies/periods, invalid amounts, and offers
below the floor are rejected. No market salary values or exchange rates are invented.
Numeric salary fixtures in tests are synthetic arithmetic examples only.

Factual validation accepts exact typed facts only. It does not claim to
validate arbitrary generated prose, infer option meanings, or prove that a cited
fact supports a novel sentence. Grounded generation and its evaluation must be
implemented before enabling generated application answers.

## Model configuration and privacy

`modelConfigurations` contains OpenAI/cloud and Ollama/local slots with bounded
input/output token allowances. Both model names are intentionally unset. Select an
explicit model; for cloud use also supply verified input/output pricing, source,
and verification date. No current model availability, price, or memory fit is
assumed. Start by evaluating a small local model on the M3/16 GB machine and a
cost-efficient cloud model against the same held-out forms before choosing a default.

The OpenAI-compatible adapter is explicitly configured by the CLI. Tool arguments
are validated at runtime with Zod and converted to existing browser actions. The
model cannot supply arbitrary answer strings: it chooses facts, personal references,
options, and explicit consent IDs. The model interprets questions and decides the
actions; production code has no mock-form-specific filling sequence.

Cloud context is filtered with the existing privacy utility. Only the fact-ID
catalog is initially sent; fact values are disclosed on demand through
`read_candidate_facts`. Personal reference values cannot be read by a model tool and
resolve only inside the local executor. State includes current control metadata,
sanitized page text/errors, consent grants, and successful-action summaries. Each
request is self-contained; raw responses and opaque reasoning are not replayed.
The baseline filter handles registered identifiers and common email/phone patterns,
not every possible personal datum. Only the authored fictional profile is supported.

## Budget behavior

Amounts are integer micro-USD: $1 equals 1,000,000 micro-USD.

- CLI monthly hard stop: **$5 by default**. Pending requests count against it.
  `MONTHLY_BUDGET_USD` can explicitly lower it or raise it as high as $8.
- Independent per-run hard stop: **$0.10 by default**, configured through
  `PER_RUN_BUDGET_USD`. Settled costs plus unresolved reservations for the run ID
  count against it, across restarts and month boundaries. A different run ID has
  its own cap but shares the same monthly budget. Both checks run under the ledger
  lock before a request. If the worst-case next request does not fit, the run stops
  with `BUDGET_RUN_STOP`, even if its eventual actual cost might be lower.
- The legacy in-memory utility retains its Phase 1 $8 upper bound for compatibility;
  paid CLI runs always use the file ledger with the configured stop.
- Desired absolute maximum: $10. This is an outer configuration ceiling, not an
  additional $2 allowance for the agent.

Before a cloud request, reserve its worst-case input and output cost using
verified pricing. Settle once with billed usage; savings release unused capacity.
An unknown request outcome retains its reservation. If actual usage exceeds the
reserved token bounds, record the cost and block further requests. The ledger uses
UTC calendar months and attributes late settlements to the reservation month.
Account for reasoning tokens and other billable usage in the eventual adapter;
discounts are not assumed. Pricing changes require updated configuration.

The CLI ledger `.careerpilot/budget.jsonl` persists reservations and settlements
across restarts. Transactions acquire an exclusive lock, replay validated records,
append a record, and fsync it before a paid request can proceed. Processes sharing
the same ledger share the limit. Corruption, partial writes, an abandoned lock, or
usage above reserved bounds fail closed. Locks are not automatically stolen: after
a crash, inspect the journal and confirm no process is running before removing
only an abandoned `.lock` file. Never discard the journal or release an uncertain
reservation without reconciling actual provider usage.

Failed/uncertain requests conservatively retain their full reservation, including
preflight failures; per-run reports include these maximum estimates. No automatic
retries occur for network errors. Invalid tool calls and fact reads are limited to
four provider calls per decision, with 20 agent turns maximum, three consecutive
browser-recovery failures, the configured action cap, and a total run timeout.

The ledger is a local single-host prototype, not a provider-wide billing control.
Another state directory, external API clients, deleted files, changed provider
prices, and provider billing adjustments are outside its guarantee. Filesystem
and clock integrity are assumed. A local application cannot guarantee an account-
wide $10 bill; use provider-side spending controls too.

At 500–600 applications/month, the $5 target allows roughly $0.0083–$0.01 per
application. This is a design constraint, not a demonstrated throughput or cost
claim. Retries and evaluation calls must also fit the budget. Batched low-risk
actions and local models can reduce cloud use; their effectiveness is not yet measured.

## Browser and batching boundaries

The allowed origin starts unset and must be explicitly set to the mock server's
exact loopback HTTP origin and port. The server binds only to `127.0.0.1`. It rejects
unexpected Host headers and cross-origin submission requests, limits payload size,
and validates required fields, options, consent, and conditional/repeated answers.

The adapter routes context-wide requests before creating pages, blocks service
workers and WebSockets, closes popups, and rejects off-origin URLs and credentials.
Only local GET/HEAD requests are normally allowed. A validated submit action opens
a one-request POST permit for the form's exact action URL and the session's run ID.
POSTs triggered by filling, selecting, or arbitrary button handlers are blocked.
Responses are fetched with redirect following disabled; **all redirects, including
same-origin redirects, are blocked** in this minimal adapter. No real job sites or
real applications are permitted. This is an application guard for controlled mocks,
not an operating-system network sandbox for arbitrary hostile websites.

Only fill/select actions can be batched. Batches have a size limit, unique targets,
and an observation ID. Checks, navigation, waits, and submissions are separate
decisions. Button effects must be established independently; unknown effects are
blocked, and a generic click cannot bypass the submission-consent guard. Each
decision consumes its observation. The executor rechecks structural observations
before execution and after each batched action; a change ends the batch with
`BATCH_REINSPECT_REQUIRED`. Only the returned prefix ran; the caller must inspect
again before choosing further actions. Fill values resolve from verified facts or
local references; select options must exactly match a verified fact's value/label.

Submission success requires an independently verified local-server receipt, not
an LLM claim or a successful click. Metadata-only event contracts avoid raw answers,
personal values, model messages, and credentials. The executor emits action events
to an optional `EventSink`; the CLI supplies a metadata-only JSONL logger.

## Known limitations

The inspector supports native main-document controls and links, not file uploads,
password fields, custom widgets, shadow DOM, or iframes. Observations omit field
values, selected state, and checked state. IDs are temporary and valid only for
their observation. Structural checks are conservative, not an atomic DOM lock.
Unsupported controls are not given a fallback automation path. The privacy filter
is applied by the policy before cloud calls, including to review-page text.

Wait actions pause for a bounded 350 ms; repeated inspection is needed for longer
delays. Native validation errors or server rejection do not become success merely
because a click executed. Only the independent verifier establishes submission.
Receipts and submission payloads are held locally in memory and disappear on
restart. The receipt endpoint is a local development aid, not an authenticated
multi-user service. The persistent budget ledger is local-only and fail-closed.
Tool schemas prevent invented literal answers, but semantic field-to-fact matching
is still an LLM task and can be wrong. Live generalization and cost/throughput at
500–600 applications/month have not been established by mocked tests.

## Next phase

After approval, evaluate the live model on the single-page mock, then extend
evaluations to multi-step/dynamic flows and future provider adapters. The fake
transport exists only in tests, never as a production fallback. Evaluate live models against unfamiliar
labels, reordered fields, conditional controls, and truthful-answer cases using
the same policy interface. Offline unit tests do not establish LLM generalization.


## Application preparation

`npm run prepare` creates a local draft packet for a real vacancy. It does not
open a browser, fetch job URLs, submit applications or alter the selected CV.
A job JSON contains explicitly reviewed country, advert language, application
instructions and a short requirement list. URLs are recorded as sources only.

Store real inputs under the ignored `.careerpilot/` directory. The private profile
contains local contact details, sourced bilingual professional facts, preferences
and absolute PDF paths. Do not add real inputs to source control. Unit tests use
fictional data only.

An offline, locally reviewed run requires no API key:

```sh
npm run prepare -- --profile .careerpilot/profile.json --job .careerpilot/peak-job.json --review .careerpilot/peak-review.json
```

The tool writes a fresh private `.careerpilot/prepared/<run-id>/` directory with
the selected PDF, `cover-letter.txt`, a Turkish `review.txt`, and a machine-readable
`preparation.json`, plus `job.json` containing the exact requirement list. It never silently replaces a previous packet. Company-specific
examples above are private local inputs, not bundled production defaults.

Document routing follows explicit application instructions first. Otherwise the
advert language determines the CV language, and country TR selects a photo while
other countries select no photo. Missing or ambiguous matching assets stop the run.
A Turkish company posting an English advert therefore selects the English photo CV.

Assessment uses only existing fact IDs. Every requirement must be covered once;
unknown IDs, free-form candidate claims and ungrounded letter text are rejected.
`documented` and `related` describe evidence availability, not complete qualification,
a hiring prediction, or an ATS score. Semantic relevance still requires human review.
The letter uses locally reviewed candidate prose when configured, otherwise exact selected profile statements, with a fixed application introduction/closing.

An optional model can choose factual references using the existing Responses adapter
and the same persistent monthly/per-run budget ledger. For a separately approved live
run, load the existing environment configuration and pass `--model`,
`--approve-paid-call` AND `--approve-cloud-profile` instead of `--review`.
Existing .env flags alone are insufficient consent for this workflow. Contact values,
CV paths, source paths and preferences are excluded from the model request; professional
facts still leave the computer when cloud mode is explicitly approved. No model calls
were needed for the local example. Live model quality remains unverified.

Missing Java/Spring Boot evidence must never become a positive claim because a profile
mentions JavaScript or Node.js. Partial degree equivalence and academic skill exposure
must remain explicit. Personalised prose generation, automatic job URL ingestion and
real-site submission are not implemented in this preparation command.

### Prepare from pasted posting text

The optional model path also accepts `--posting` instead of `--job`. This removes
manual requirement lists and a separate review-plan file: one accounted model request
extracts requirements and selects candidate references together. It still requires
fresh paid-call and cloud-profile approval. No URL is fetched.

Put the posting text and explicitly checked metadata in a private JSON file:

```json
{
  "version": 1,
  "id": "example-graduate",
  "company": "Example Studio",
  "title": "Graduate Engineer",
  "country": "TR",
  "language": "en",
  "sourceUrl": "https://example.invalid/jobs/graduate",
  "checkedOn": "2026-10-17",
  "text": "Qualifications\nRelevant degree required.\nJava Spring Boot experience required.\nResponsibilities\nBuild backend APIs."
}
```

Check explicit application instructions yourself: set `documentLanguage`, `photoPolicy`
and `sponsorship` where stated. Their defaults are null, unspecified and not_stated;
the model cannot change these fields or infer work authorisation. Country and advert
language are mandatory. Raw text is bounded to 24,000 characters and remains untrusted.

After a separately approved live run, with the existing environment configuration loaded:

```sh
npm run prepare -- --profile .careerpilot/profile.json --posting .careerpilot/posting.json --model --approve-paid-call --approve-cloud-profile
```

Each extracted requirement must be a verbatim excerpt of the model-visible posting
(whitespace may differ). Invented quotations, unknown candidate references and invalid
plans stop packet creation; billable invalid responses are still accounted without retry.
The private packet includes `posting.txt` and `job.json` so the original text and
extracted requirements can be compared. Contact values are redacted before cloud input;
professional profile facts and posting text are sent only with the explicit approval.

Verbatim checks prove that selected text exists, not that the model extracted every
requirement or classified it correctly. Review completeness and relevance before using
any packet. The letter renderer preserves reviewed general candidate prose when configured, then
adds up to two selected facts not already covered by that prose.
This workflow has been tested with a mocked provider only. Live extraction quality,
automatic URL ingestion, free-form cover-letter writing and real-site submission remain
unverified or unimplemented; a local test does not establish any of those capabilities.

### General candidate narrative in cover letters

An optional private profile field `coverLetter` contains `reviewedOn` and `sections`.
Each section has `kind` (`introduction`, `background`, `experience`, `projects`),
bilingual `text` (`tr`, `en`), and existing `factIds` supporting the text. Start with
introduction and keep this order; omitted later sections are allowed. The entire
field remains local and is not included in cloud requests. Example with fictional data:

```json
{
  "reviewedOn": "2026-10-17",
  "sections": [{
    "kind": "introduction",
    "text": { "tr": "Yazılım alanında yeni mezunum.", "en": "I am a recent software graduate." },
    "factIds": ["education"]
  }]
}
```

Use prose reviewed against your actual profile; the example assumes an `education`
fact already exists. Unknown or duplicate references, reordered sections and overly
long paragraphs are rejected. Experience and projects are capped at 450 characters
per language; introduction/background at 650. Keep them brief and balanced.

The renderer keeps this general narrative intact, adds the company and job title,
and appends at most two model-selected factual sentences not already represented
by the narrative references. It never pastes raw job requirements as candidate
claims. The manifest's `letter` section records narrative references separately
from the model's assessment plan, so actual rendered content can be traced.
Older profiles without this field still use selected factual sentences. These are
plain text drafts; no free-form model prose, layout/ATS score or hiring outcome is
promised. Valid references do not prove semantic accuracy: review the prose when
creating or updating your profile and review each final application.

## Lever form inspection and local rehearsal

`npm run lever:inspect -- --profile .careerpilot/profile.json --job .careerpilot/peak-job.json --answers .careerpilot/lever-answers.json`
follows the exact application link from one public jobs.lever.co posting, inspects
its form and writes a private `.careerpilot/form-reviews/<id>/` packet. This is a
read-only network workflow: scripts/workers are disabled, all writes and cross-origin
resources are blocked, and contact values are never entered into the live page.
It uses no model or API credits. It does not navigate LinkedIn or sign in there;
the employer URL must already be present in the job input.

Optional private answers contain `university` (exact displayed option), `linkedin`,
`github` and `portfolio` HTTPS URLs. Unknown required questions, ambiguous controls,
missing answers and consent decisions remain unresolved. Current employer is not
inferred from an internship. The selected CV is recorded, not uploaded. Resume
upload approval and the legal privacy consent remain separate unresolved steps.
There is no cover-letter upload unless a future inspected form actually requests it.

The separate rehearsal helper fills only authored 127.0.0.1 pages and is tested on
a fictional Lever-shaped fixture. It never uploads a file, accepts consent, clicks
submit, or permits live-site filling. No live form filling or submission support
is claimed. Public Peak markup was inspected through the browser, but the CLI's
network navigation and selectors still need a live read-only run to establish
compatibility beyond the local fixture. Do not treat a rehearsal as a real application.
Private review packets contain contact values and local CV paths; do not commit or share them.
