# CareerPilot

CareerPilot is a personal, AI-first job application agent. Phase 1 provides the
TypeScript contracts, fictional candidate data, and deterministic guards for a
future local browser-agent prototype. There is no executable application agent yet.

## Setup

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run check
```

`npm test` runs offline unit tests with Node's test runner through `tsx`.
`npm run typecheck` checks the source and tests without emitting files.
No API keys, model downloads, browser installation, or paid calls are required.
Dependency installation requires access to the npm registry.

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
- `tests/`: offline tests of the above boundaries and failure cases.

These are contracts and foundation utilities. Phase 1 does not implement browser
automation, mock forms, provider adapters, API requests, the LLM decision loop,
runtime tool schemas, job discovery, CV generation, Gmail, or a model router.
Playwright and provider SDK dependencies will be added when those adapters exist.

## Candidate data and application policy

The fixture describes an invented candidate. "Verified" means checked against the
authored fictional source; it is not verification of a real person's credentials.
Unknown information stays absent. Identity and email are local references such as
`personal.email`; future executors resolve them locally without sending the values
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

The allowed origin starts unset. Later it must match the exact literal loopback
HTTP origin and port of the mock server. Navigation, redirects, popups, form actions,
and browser requests must all be enforced by the future executor. No real job sites
or real submissions are permitted in the prototype.

Only fill/select actions can be batched. Batches have a size limit, unique targets,
and an observation ID. Checks, navigation, waits, and submissions are separate
decisions. Button effects must be established independently; unknown effects are
blocked, and a generic click cannot bypass the submission-consent guard. The future
executor must stop and reinspect when a batch changes the page, and must prevent
input handlers from triggering unverified submission. Action typing alone is not
sufficient to guarantee those browser effects.

Submission success requires an independently verified local-server receipt, not
an LLM claim or a successful click. Metadata-only event contracts avoid raw answers,
personal values, model messages, and credentials; a persistent logger is future work.

## Next phase

Implement the mock server, Playwright adapter, actual `LLMDecisionPolicy`, and
OpenAI/Ollama adapters. Inject a fake LLM transport for offline tool-loop tests;
never activate it as a production fallback. Evaluate live models against unfamiliar
labels, reordered fields, conditional controls, and truthful-answer cases using
the same policy interface. Offline unit tests do not establish LLM generalization.
