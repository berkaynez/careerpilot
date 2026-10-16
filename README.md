# CareerPilot

CareerPilot is a personal, AI-first job application agent. Phase 2 adds a loopback
mock application server and a guarded Playwright browser adapter to the Phase 1
contracts, fictional data, privacy filter, and budget utilities. There is no LLM
decision loop or real job-site integration yet.

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

## Architecture

The intended loop is observation → LLM tool call → deterministic validation →
Playwright execution → fresh observation. The LLM interprets questions and chooses
actions. Deterministic code enforces references, policy, privacy, budgets, and
execution boundaries; it does not map specific forms to candidate answers.

- `src/contracts.ts`: agent decisions, observations, browser executor, submission
  verifier, outcomes, and metadata-only event sink. `DecisionPolicy` will be
  implemented by `LLMDecisionPolicy`; no deterministic production policy exists.
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
- `tests/`: offline tests of the above boundaries and failure cases.

Provider adapters, LLM API requests, the decision loop, runtime LLM tool schemas,
job discovery, CV generation, Gmail, and a model router remain unimplemented.
The provider-neutral interface and budget code are unchanged.

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

Phase 1 factual validation accepts exact typed facts only. It does not claim to
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

No adapter is implemented or silently selected. Future adapters must implement
real tool calling, validate unknown tool arguments, account for all billable tokens,
and honor abort signals. Model or tool failures stop safely; there is no automatic
provider switch or fallback to unsafe browser behavior.

Cloud calls must receive filtered context, including sanitized tool results and
history. The baseline filter handles registered identifiers and common email/phone
patterns, not every possible personal datum. Public facts require review before
real profiles are supported. No live calls are enabled in this phase.

## Budget behavior

Amounts are integer micro-USD: $1 equals 1,000,000 micro-USD.

- Monthly target: $5. Reaching it is visible through `targetReached`.
- Application hard stop: $8. Pending requests count against it. Configuration may
  lower this cap but cannot raise it above $8.
- Desired absolute maximum: $10. This is an outer configuration ceiling, not an
  additional $2 allowance for the agent.

Before a future cloud request, reserve its worst-case input and output cost using
verified pricing. Settle once with billed usage; savings release unused capacity.
An unknown request outcome retains its reservation. If actual usage exceeds the
reserved token bounds, record the cost and block further requests. The ledger uses
UTC calendar months and attributes late settlements to the reservation month.
Account for reasoning tokens and other billable usage in the eventual adapter;
discounts are not assumed. Pricing changes require updated configuration.

**The Phase 1 ledger is in memory.** It cannot enforce a monthly cap across restarts,
multiple processes, external API clients, or provider billing adjustments. Durable,
atomic shared accounting and provider-side spending controls must be addressed
before enabling paid API calls. A local application cannot guarantee an account-wide
$10 bill by itself.

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
to an optional `EventSink`; a persistent logger is future work.

## Known limitations

The inspector supports native main-document controls and links, not file uploads,
password fields, custom widgets, shadow DOM, or iframes. Observations omit field
values, selected state, and checked state. IDs are temporary and valid only for
their observation. Structural checks are conservative, not an atomic DOM lock.
Unsupported controls are not given a fallback automation path. The privacy filter
still must be applied before any future cloud call, especially to review-page text.

Wait actions pause for a bounded 350 ms; repeated inspection is needed for longer
delays. Native validation errors or server rejection do not become success merely
because a click executed. Only the independent verifier establishes submission.
Receipts and submission payloads are held locally in memory and disappear on
restart. The receipt endpoint is a local development aid, not an authenticated
multi-user service. Existing in-memory budget limitations still apply.

## Next phase

Implement actual `LLMDecisionPolicy` and OpenAI/Ollama adapters, with runtime tool
validation and durable accounting before paid requests. Inject a fake LLM transport for offline tool-loop tests;
never activate it as a production fallback. Evaluate live models against unfamiliar
labels, reordered fields, conditional controls, and truthful-answer cases using
the same policy interface. Offline unit tests do not establish LLM generalization.
