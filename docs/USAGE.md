# Teknik kullanım referansı

Bu dosya kurulum, komutlar ve alt sistemlerin ayrıntıları içindir.
Güncel ürün kapsamı ve yapılacak işler için [proje durumu](PROJECT_STATUS.md),
başlangıç için [README](../README.md) esas alınır. Buradaki eski geliştirme
başlıkları bir yol haritası değildir. Örnekler kurgusaldır; gerçek profil ve
başvuru belgeleri yalnızca özel, Git dışında tutulan dizinlerde saklanır.

## İçindekiler

- [Kurulum](#setup) ve [yerel demo](#local-demo)
- [Onay gerektiren model denemesi](#first-live-ai-test-after-approval)
- [Model altyapısı](#architecture), [bütçe](#budget-behavior), [sınırlar](#known-limitations)
- [Yerel başvuru hazırlığı](#application-preparation)
- [Lever hazırlığı ve insan devri](#lever-form-inspection-and-local-rehearsal)
- [İlan bağlantısıyla başlangıç](#start-from-job-links-instead-of-a-company-specific-job-file)
- [Ortak form yardımcısı](#indeed--kariyernet-and-the-shared-visible-form-assistant)
- [Başvuruya özel cevaplar](#reviewed-application-specific-answers)

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

The local AI experiment uses observation → LLM tool call → deterministic validation
→ Playwright execution → fresh observation. This describes `npm run agent` on local
fictional forms. Real-site `assist` is a separate deterministic, supervised path:
it matches reviewed answers to known labels and makes no model calls. These two
paths are not an integrated autonomous production agent.

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

Automatic vacancy discovery, CV generation, email follow-up and additional
provider adapters are not implemented. The local dashboard is described under Local hub dashboard. Public user-supplied job-link intake and
selection/copying of existing CVs are implemented in `src/jobs` and `src/preparation`.
Provider configuration slots do not constitute working provider integrations.

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
submit, or permits live-site filling. The separately approved filled-preview mode
is described below; real upload has a separate consent-gated mode below; application submission is not implemented. A live read-only CLI run on the Peak posting on 2026-10-17 followed the application
link and prepared five fields, leaving CV upload and privacy consent unresolved.
No personal data was entered, no file was uploaded and no model call was made.
Other Lever postings and JavaScript-dependent forms remain unverified. Do not treat a rehearsal as a real application.
Private review packets contain contact values and local CV paths; do not commit or share them.

### Filled form preview with explicit approval

`npm run lever:preview -- --profile .careerpilot/profile.json --job .careerpilot/peak-job.json --answers .careerpilot/lever-answers.json --approve-contact-sharing --approve-cv-selection`

Both per-run approvals are required before launching a browser or reading the CV.
Do not run this against a real profile without the user's approval for the specific
employer and data. It reopens the exact employer form in a fresh script-disabled
session, fills only mapped fields, selects the matching PDF in the browser's file
input, verifies the resulting field values and captures a private `filled-form.png`
and `preview.json` under `.careerpilot/form-previews/<id>/`.

This is a **filled preview**, not a server upload or a resumable application.
The browser closes after capture. All POST requests, site scripts, workers and
cross-origin resources remain blocked; selecting a PDF does not trigger Lever's
remote resume parsing. `cvUploaded` and `submitted` remain false. No checkbox,
radio, CAPTCHA, legal consent or submit button is activated. Unknown required
answers stop the run before data entry. It uses no model/API tokens.

This increment passed authored fictional form tests. With explicit per-run approval,
a live Peak preview on 2026-10-17 filled five fields and verified local selection of
the English photo CV, then saved a screenshot and closed the browser. KVKK consent
remained unchecked; cvUploaded=false, submitted=false and modelCalls=0. Real upload,
a separate scripted upload mode is described below; application submission remains unimplemented. Do not call a locally
selected filename a successful upload.

### One CV upload without submitting an application

The private Lever answers can include both `linkedin` and `github` HTTPS links;
these map to the site's corresponding URL fields alongside the existing five
contact/university fields. No portfolio URL is inferred from an email domain.

A synthetic, fully blocked live probe on 2026-10-17 observed the hosted form's
`POST https://jobs.lever.co/parseResume` request containing `resume` and `accountId`.
Every write was aborted before transmission. This identifies an internal hosted-form
behaviour, not a documented or stable public standalone-upload API.

After explicit per-run approval to share the named CV and contact/link information
with the employer through Lever, the new mode is:

```sh
npm run lever:upload-draft -- --profile .careerpilot/profile.json --job .careerpilot/peak-job.json --answers .careerpilot/lever-answers.json --approve-contact-sharing --approve-cv-upload
```

This is real file transmission, unlike `lever:preview`. It permits only one exact
multipart request to the observed resume endpoint, matching the selected PDF's
name, MIME type and bytes and the account ID from that job's form. Extra form fields,
different files, destinations, redirects and repeat requests are blocked. Other
POST requests, sockets, workers, third-party scripts, CAPTCHA widgets and submission
controls remain blocked; this mode does not accept legal consent or submit.

Upload verification requires a successful HTTP response, a newly populated site
storage field and the expected filename displayed by the site. Resume parsing can
overwrite contact fields, so the program reapplies and verifies the sourced values
and links afterwards. A private screenshot and metadata checkpoint are written
under `.careerpilot/upload-reviews/<id>/`; contact values and parsed resume response
bodies are not logged. The browser closes after capture, so this is not a resumable
application. An uploaded file may be retained by Lever even without final submission.

Uncertain or failed uploads stop without retry, and the checkpoint distinguishes
request allowance from verified upload. Review it before authorising any repeat.
One explicitly approved live CV upload was verified on 2026-10-17. The screenshot
revealed an incorrect parser-filled current employer and an empty location, so its
form checkpoint was corrected to `stopped_requires_review` with `fieldsVerified:false`.
No application was submitted, no legal consent accepted and no repeat CV upload made.

The fixes clear an unsourced current employer, select an exact reviewed city suggestion
and recheck every field after focus changes and screenshot capture. For scripted Lever
forms with `selectedLocation`, answers must include `locationSelection` with a reviewed
`query` and exact suggestion `label`. Only that exact GET `/searchLocations?text=...`
is permitted; other API reads remain blocked. This is a display equivalent of the
profile city, not permission to invent a location. Fictional browser fixtures cover
parser overwrites, autocomplete, final-value checks and uncertain uploads. A separately approved repeat of the corrected full flow subsequently passed live
verification: upload evidence and all seven planned fields were verified, including
the selected city, cleared unsourced employer and both profile links. No application
was submitted, no consent accepted and no model call made. Changed hosted-form
behaviour must still stop.

The corrected location adapter was separately verified on the live form using only
the city query: one city-search GET, zero writes, no CV/contact upload and no consent.
The city-only check was followed by the separately approved full verification above.

### Keep the prepared form open and take control

```sh
npm run lever:review -- --profile .careerpilot/profile.json --job .careerpilot/peak-job.json --answers .careerpilot/lever-answers.json --approve-contact-sharing --approve-cv-upload
```

This is the same real, consent-gated CV upload as `lever:upload-draft`, with a visible
isolated browser. It requires an interactive terminal and performs no model calls.
Do not use it just to view a previous screenshot: each invocation uploads the selected
CV again. `lever:upload-draft --keep-open` is equivalent.

After upload and final field verification, the browser stays open and the terminal
waits for an explicit choice:

- `DEVRET`: take manual control of this same prepared form. Normal browser network
  traffic is enabled and submission/consent click guards are removed. Only deferred
  hCaptcha bootstrap scripts are restarted; the CV is not reattached or uploaded again.
  Review/edit the information and complete any legal consent, CAPTCHA and submission
  yourself. The program never clicks these controls or solves CAPTCHA.
- `KAPAT`, terminal EOF, or closing the prepared page before transfer: close without
  granting manual control or submitting. An already uploaded CV may remain on Lever.
- Other terminal text keeps the form guarded. Before transfer the program checks the
  values, CV storage/filename and unchecked consent again; changed/missing evidence
  stops the session rather than silently releasing an incorrect form.

Leave the terminal running during manual work; close the prepared browser window when
finished. The program does not watch personal edits, legal consent, CAPTCHA or the
application outcome after transfer. Its checkpoint records `manualControl:true`,
`automationSubmitted:false`, and `submitted:null` / `consentAccepted:null`; the saved
screenshot and `verificationTime` describe the form **before** manual control. Closing
this isolated browser loses the session; there is no saved login or cross-run resume.

Offline browser tests exercise keeping the form open, refusal/cancellation, a changed
field preventing transfer, deferred CAPTCHA script loading and manual submission to a
fictional mocked endpoint with the original upload retained. All external responses
are mocked. The keep-open/handoff mode, real CAPTCHA and final submission have not
been exercised on the live employer site; the earlier live checks cover automated
preparation and upload only.

### Start from job links instead of a company-specific job file

The general entry point is `npm run job`. It uses the local private profile and
shared Lever answers by default. No manually authored `job.json`, API key or model
call is needed for this workflow.

```sh
npm run job -- "https://jobs.lever.co/example/11111111-1111-4111-8111-111111111111" --country TR --language en
```

Use a real posting URL in place of the fictional example. Supported public inputs:
LinkedIn `/jobs/view/...`, Lever posting/application URLs and Greenhouse hosted
`/<company>/jobs/<id>` URLs. Up to ten URLs may be supplied for sequential **local
preparation**; supervised upload/review accepts only one job per invocation.

Public pages are read without login, scripts, form filling, uploads or model calls.
For LinkedIn, the program follows one unique, actually observed supported employer
link, including an observed external-apply redirect target. It never guesses that
link, bypasses a login/access challenge, or searches arbitrary destinations. If
there is no accessible unique link, `employer_link_required` explains the limitation;
provide the employer URL you get from the site's Apply button. Unsupported sites
are rejected explicitly.

The country and advert language must be supplied explicitly (`TR`/`GB` etc., `tr`
or `en`); they are not silently inferred from the applicant's preferences or the
site's interface language. Title/company are extracted from public job metadata or
matching headings/page titles; use `--title` / `--company` if unavailable. Explicit
`--document-language` and `--photo-policy required|forbidden|unspecified` cover special
application instructions. Review these choices against the advert before sharing.

A private `.careerpilot/jobs/<id>/` packet contains the source/discovery record,
`application.json`, `posting.json`, copied selected CV, a general candidate-first
`cover-letter.txt`, and Turkish `next-steps.txt`. Lever packets also contain inspected
form fields and a draft with missing answers. The cover letter reuses reviewed
profile prose or sourced general profile facts; this step **does not** perform a
qualification assessment or claim the candidate is a match. The raw `posting.json`
can be used with the existing separately approved model preparation workflow later.

- Lever: known fields can be filled and the selected CV uploaded in the approved
  supervised mode below; additional required answers/files remain for the human.
- Greenhouse: prepares the local CV/letter packet and source link for manual use;
  automated filling/upload is **not implemented**.
- LinkedIn Easy Apply, Workday and other application systems are **not implemented**.

For an explicitly approved real Lever run in an interactive terminal:

```sh
npm run job -- "https://jobs.lever.co/example/11111111-1111-4111-8111-111111111111" --country TR --language en --review --approve-contact-sharing --approve-cv-upload
```

This invocation really shares the selected CV/contact values with the resolved Lever
employer. It keeps the form open and shows remaining questions/consents before the
human types `DEVRET`. Unknown text/select/file questions are not answered by the
program; ambiguous mappings or an unrecognised resume control still stop. The
unattended upload mode continues to refuse missing required answers before upload.
After manual transfer only the user edits remaining fields, accepts consent, solves
CAPTCHA or submits. No automatic submission or paid call was added. To open a
previously prepared Lever packet without repeating public intake, the existing
`lever:review` command accepts its `application.json` with `--job` and its
`answers.json` with `--answers` (plus the profile and sharing flags).

**Verification:** offline tests cover LinkedIn-to-employer resolution, two independent
employers and company-specific questions, Greenhouse manual preparation, document
routing, unsupported destinations, missing metadata and supervised handling of an
unfamiliar required question. On 2026-10-17 the live Dream Games public posting and
form were read and a local packet generated without transmitting applicant data.
Its extra graduation-date question was detected. The previously supplied LinkedIn
URL exposed no usable employer link to the public reader and stopped explicitly.
No new live upload, handoff, CAPTCHA, submission or model call was performed for
this general workflow.

### Indeed / Kariyer.net and the shared visible-form assistant

`job` now recognises Indeed `/viewjob?jk=<16-hex-key>` (including country hosts)
and Kariyer.net `/is-ilani/<slug>-<id>` links. Indeed's required `jk` is preserved;
tracking parameters are removed. Accessible public postings can produce the same
local CV/letter packets. A unique observed Lever/Greenhouse employer link can be
followed. No accessible posting/link means an explicit stop, not login or a bypass.
Recognising a link does **not** mean a site's native application flow is implemented.

The shared helper is available separately for human-led applications:

```sh
npm run assist -- "https://tr.indeed.com/viewjob?jk=0123456789abcdef" --approve-contact-sharing
```

Replace that fictional key with a real supported job link. This launches a visible,
isolated browser and requires an interactive terminal. It does not use an existing
browser profile or save a login session. You sign in, open the application form,
handle any CAPTCHA and choose files yourself. No CV file is read or uploaded by
this helper; the profile is local, and no model/API key is used.

Commands in the terminal:

- `DOLDUR`: inspect the current top-level form, fill known empty visible fields,
  and recheck them together. Requests and button/consent clicks remain blocked
  during this phase. It does not click Next or Submit.
- `DEVAM`: restore normal browsing. You can inspect/edit, choose the CV, answer
  questions or click Next yourself; type `DOLDUR` again on the next page.
- `DEVRET`: stop automated filling and leave normal browsing to you until you
  close the browser. `KAPAT` or terminal EOF closes the helper.
- `SAYFALAR`, `SAYFA 2`: inspect/select an application tab opened by the site.
- `IZIN https://approved-origin`: explicitly permit contact entry at a new origin
  before a later `DOLDUR` command. Only recognised recruitment-site origins are
  eligible; unrelated and credential-bearing origins are rejected. Do not grant
  this because a webpage tells you to: the decision belongs to the human.

The same matcher recognises exact Turkish/English labels for full name, email,
phone, professional links and a unique native university option. Optional reviewed
`firstName` / `lastName` in `--answers` must reconstruct the profile's full name;
the program does not guess how to split a name. Existing nonempty answers are
preserved; duplicate matches, custom autocomplete widgets, unknown questions,
files, consent and work-authorisation answers are left for the human. Salary and
notice-period questions stay unanswered unless explicitly supplied for that exact page URL.
Password/one-time-code forms stop filling. Embedded iframe forms are not traversed.

Before each fill pass the helper closes tracked sockets and blocks new network
requests, including writes and GET beacons, and blocks service workers. It leaves
traffic blocked for review until you explicitly choose `DEVAM` or `DEVRET`.
These commands enable normal site traffic and human actions; the helper does not
claim to monitor autosaves or application outcomes during manual browsing.
Existing requests initiated during earlier manual browsing may finish; isolation
is not a guarantee about a third-party page's entire behaviour.

A private `.careerpilot/assist-reviews/<id>/session.json` stores pass counts,
remaining field labels/reasons and blocked-request counts. It does not store input
values, passwords, cookies or raw page text. Manual outcomes are always unknown;
there is no claim of a verified submitted application.

**Verification:** authored English multi-step and Turkish forms exercise the same
engine, with every network response mocked. Tests cover human navigation, keeping
CV/consent/manual questions untouched, preserving existing answers, duplicate labels,
login and origin checks, name-part consistency, write/GET-beacon blocking and final
value verification. These fixtures are not replicas or recordings of the real
Indeed, Kariyer.net, LinkedIn or Workday application UIs. No real accounts, real uploads,
CAPTCHA completion or submissions have been exercised with this helper. Native
end-to-end automation for Indeed/Kariyer.net and LinkedIn Easy Apply remains unverified.


A public-browser check on 2026-10-18 opened an Indeed posting and its
“Şirket Sitesinden Başvur” control. That control displayed an email-only sign-in
iframe. No account information was entered. The standalone public reader could
not access that same posting; the browser observation does not establish reader
or signed-in application compatibility. The assistant now recognises visible
email-only sign-in headings and auth iframes before filling any contact field;
ordinary header login links or hidden auth frames do not block a real form.
These detection changes are covered with fictional browser fixtures. That public-browser check did not test signed-in filling, upload or submission
through the CLI. A later chat-operated Workday session is recorded separately
below and does not validate CLI support.


### Reviewed application-specific answers

The shared assistant also recognises the accessible name of a surrounding question
(group/fieldset) when it contains exactly one editable control. Multi-control groups
and custom dropdowns still require human selection. Textareas are supported.

An optional private `--answers` file can include the following fictional example:

```json
{
  "application": {
    "url": "https://example.invalid/jobs/fictional-role/apply",
    "noticePeriod": "Two weeks.",
    "salaryExpectation": "1600"
  }
}
```

These values are used only when the current page URL exactly matches `application.url`;
they are never inferred from the posting or reused for another vacancy. Existing
nonempty answers are preserved. The numeric salary does not set currency, gross/net
or monthly/annual units; review those separately. No legal/work-authorisation answers
are inferred. This extension is tested on fictional forms, not a live Workday run.

On 2026-10-18 a separate, supervised browser session reached an Infobip Workday
application receipt after the user submitted it. That session used the chat's browser
tools, not the shared `assist` CLI; it does not establish native Workday automation.
No paid model call was made for that browser session.


### Explainable match score

`prepare` now includes `matchScore` (0–100 or `null`) in its CLI result and a
`match` object in the private `preparation.json`. The readable `review.txt` shows
the score, formula, each requirement's earned/possible points and existing profile
evidence. This also applies after the existing consented model-posting analysis;
scoring adds no second model call. `job` link packets without a reviewed requirement
assessment still do not have a qualification score.

Policy `evidence-coverage-v1` uses essential weight 3, preferred weight 1 and
responsibility weight 0. Evidence credit is 1 for documented, 0.5 for related and
0 for not documented. The rounded score is `100 * earned / possible`. It measures
coverage of extracted requirements, not hiring probability or an external ATS score.
Extraction and semantic matching require human review; valid references alone do
not prove relevance or that every requirement was extracted.

All missing evidence can produce a genuine zero without inventing letter facts
(`coverLetterFactIds` may be empty). Responsibility-only postings produce `null`
with `no_scorable_requirements`. Invalid or incomplete analyses fail validation;
there is no default score on error. Work authorisation and sponsorship conflicts
are recorded separately and cannot be overridden by a high score.

The existing offline reviewed-plan command now also produces the score:

```sh
npm run prepare -- --profile .careerpilot/profile.json --job .careerpilot/job.json --review .careerpilot/review.json
```

All three inputs must already exist and match the documented schemas. This command
uses the supplied local review, makes no paid call and submits no application.
Model analysis remains a separate explicitly approved operation with the existing
budget/privacy controls. Live-model scoring quality has not been evaluated in this change.


### Local hub dashboard

The local panel reuses the existing profile schema, posting analysis, match scoring
and persistent model budget. It has no new dependency or provider abstraction.

```sh
npm run hub -- --demo
npm run hub
npm run hub -- --profile .careerpilot/profile.json --port 3211
```

The first command uses fictional profile/jobs and `.careerpilot/hub-demo/jobs`;
it cannot enable the model or load a real profile. Normal mode loads the private
`.careerpilot/profile.json` (or the explicit CLI profile) and stores records in
`.careerpilot/hub/jobs`. `CAREERPILOT_STATE_DIR` changes the state directory.
Only one hub process may write a given directory. Each record is schema-checked,
private (0600 in a 0700 directory) and atomically replaced. Profile fact IDs must
remain consistent with imported and previously saved analyses.

The panel runs on `127.0.0.1:3210` by default, with a configurable port. It binds
only loopback, checks Host/Origin and uses a per-process session token. It serves
only its fixed local assets, never a general filesystem or arbitrary URL proxy.
Job text is displayed as text, not HTML. No external CDN is required.

Implemented UI actions:

- Save a company, role, HTTPS source URL, verified country, language and pasted posting text.
- Search/filter jobs; open source links manually; view per-requirement evidence,
  match calculation and work-authorisation/sponsorship separately.
- Import a private `job.json` and `preparation.json` pair from existing preparation.
  References are checked against the active profile and the score is recomputed.
  Imported requirements are labelled as imported, not the complete original posting.
- Change tracking status. `submitted` is explicitly the user's record, not an
  independently verified employer receipt. A record with no analysis cannot be marked analysis-ready.
- Display the profile-selected CV language/photo policy; files are not sent or uploaded.

The normal hub has no model access by default. To enable the existing model path:

```sh
npm run hub -- --enable-model
```

This explicitly loads the project's `.env` if present and validates the same model,
verified pricing and budget configuration as `prepare`. It does not make a call at
startup. Each Analyze action separately requires paid-call and professional-profile
sharing approval. Contact values and CV paths/files are excluded using the existing
preparation projection. There is no automatic model retry or refresh-triggered call.
One analysis can run at a time; repeated concurrent requests are rejected. Successful
accounted cost is saved and shown. Provider uncertainty retains the existing ledger
reservation; the panel does not convert a failed request into a zero score or a free call.
Demo mode rejects `--enable-model` and `--profile`.

The panel can launch supervised form assistance (see below), but does not
attach CVs, submit applications or fetch arbitrary posting sites. Paste the posting
when adding a job. The existing standalone CLI remains unchanged.

Verification uses fictional data and injected/mocked analyzers. Browser checks
covered add, search/filter, status update, reload persistence, importing reviewed
analysis, empty-filter display and desktop/narrow layouts. No real profile was
sent to a model and no real application was submitted for panel verification.


### Form assistance from the local hub

The hub Form Assistant section opens a fresh, headed Chromium session after the
human approves the named recipient and data categories. Opening never fills fields;
the user opens the form and explicitly clicks Boş alanları doldur. The panel uses
`fillKnownApplicationFields` and `assistTransport`; no second model/filling engine
or new site adapter was added. Standalone `assist` keeps its terminal-command flow.

- Boş alanları doldur: fills known empty visible fields, verifies the result and
  leaves network/submission guards in place for review.
- Tarayıcıda devam et: restores normal site traffic for manual navigation, login,
  CAPTCHA, CV selection and consent. A later fill requires another explicit click.
  Blocked autosaves are not replayed automatically.
- Kontrolü devral: ends automation permanently in that session; no subsequent fill,
  tab selection or origin approval is accepted. The human finishes the application.
- Oturumu kapat: closes only this assistant's browser; the private log is retained.
- Form sekmesini seç: selects a stable opaque tab ID. Popups do not automatically
  become filling targets.
- Bu adreste doldurmaya izin ver: requires fresh approval for the exact selected
  origin. Unsupported recipients remain manual; webpage content cannot grant permission.

Panel APIs retain Host/Origin and session-token checks. Only one assistant browser
may be active per hub. Opening/filling/handoff never marks a job submitted; outcome
remains unknown. Refresh reconnects to a live in-memory session. Restart does not
restore cookies or windows. Stopping the hub closes its owned assistant browser.

Normal hub mode accepts --answers <private-json> or the existing optional
.careerpilot/lever-answers.json. Optional first/last names in the confirmation must
reconstruct the profile's full name; the shared engine does not guess name parts.
URL-scoped salary/notice answers keep their exact application scope. CV upload
remains manual in this common panel flow; the separate approved Lever upload CLI
is preserved. Legal consent and final submission remain human actions.

Start links match existing LinkedIn, Indeed, Kariyer.net, Lever and Greenhouse URL
formats; this does not establish native live-account compatibility. Workday remains
unsupported for automatic filling. Users can open unsupported sources normally.

Demo mode starts an owned loopback mock and uses only the fictional profile. External
example job URLs are not visited. The mock tests filling/control, not live matching.
No arbitrary loopback URL can be supplied through the public API. Session logs in
assist-reviews/<uuid>/session.json contain origin, counts/reasons and command metadata,
not contact values, cookies, passwords or raw HTML. Remaining questions are shown in
the panel. Known iframe/custom-widget limits remain unchanged.

Verification uses fictional forms for consent-before-launch, single-session gating,
verified filling, blocked side effects, manual continuation, stable tabs, exact
recipient rejection/approval, failed verification and permanent handoff. The panel
itself was exercised against the owned local mock. No paid calls or real applications
were made; real signed-in site compatibility remains unverified.

### Başvurulanları takip etme

Başvuruyu kendin tamamladığında ilanın “Başvuru durumun” alanını “Başvuruldu”
olarak değiştir. Masaüstü ve dar ekranlarda görünen **Başvurulanlar** düğmesi
yalnızca bu kayıtları gösterir; yanındaki sayı kayıt adedidir. Bu seçim ve mevcut
durum filtresi aynı listeyi kullanır. Kayıt yerel diskte korunur; şirketten otomatik
başvuru doğrulaması veya e-posta takibi yapılmaz.

### Telefon alanının sınırları

Ortak yardımcı “Mobile phone number” etiketini de tanır. Ayrı ülke kodu varsa
yalnızca profilde açıkça +90 ve on rakamlı numara bulunması, kodun standart
select alanında tekil +90 seçeneğiyle doğrulanması halinde ulusal numarayı yazar.
Başka ülke kodlarını, özel liste widgetlarını veya belirsiz seçenekleri tahmin etmez;
mevcut farklı kodu değiştirmez. Gerçek sitelerdeki uyumluluk ayrıca doğrulanmalıdır.


## Resmî kaynaklardan ilan keşfi

Panelde **İlan keşfet** düğmesini aç. Her şirket için sağlayıcı, kaynak kodu ve
şirket etiketi ekle. Kod, Lever veya Greenhouse kariyer URL'sindeki şirket bölümüdür;
örneğin `jobs.lever.co/peakgames` için `peakgames`. Tüm şirketleri kapsayan bir
arama API'si değildir. Şirket etiketi kullanıcının verdiği addır.

Pozisyonlar başlıkta, konumlar kaynağın konum etiketinde, ek anahtar kelimeler
başlık/açıklamada aranır. Dolu her grubun sağlanması gerekir; grup içinde VEYA
uygulanır. Hariç sözcükler başlıkta aranır. Boş konum/anahtar kelime grubu
kısıtlama koymaz. Senior başlıkları varsayılan olarak dışlanır, ancak junior
uygunluğu garanti edilmez. Bilinmeyen deneyim, ücret, sponsorluk veya ülke
bilgisi uydurulmaz. Remote etiketi Türkiye'den çalışılabildiği anlamına gelmez.

**Kaydet ve ilanları bul** yalnızca resmî GET uç noktalarından veri alır:
- Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true`
- Lever (global): `https://api.lever.co/v0/postings/{board}?mode=json&limit=100&skip=0`

İstekler backend üzerinden, kimlik bilgisi ve tarayıcı oturumu taşımadan yapılır;
yönlendirme izlenmez. Açıklamalar düz metne çevrilir, uzak HTML çalıştırılmaz.
API'nin verdiği her ilan bağlantısı sağlayıcı, şirket kodu ve ilan kimliğiyle
karşılaştırılır. LinkedIn/Indeed/Kariyer.net/Glassdoor taraması ve Lever EU
uç noktası bu teslimde yoktur. Örnek mod dış kaynağa çıkmaz.

En çok 20 kaynak, yanıt başına 4 MB, istek başına 12 saniye, Lever için en çok
10 sayfa ve tarama başına 100 yeni kayıt sınırı vardır. Kaynak başına 15 dakika
bekleme, ağ isteğinden önce diske kaydedilir ve yeniden başlatmada korunur.
429/ağ hatasında otomatik yeniden deneme yoktur. Her kaynak sonucu ayrı gösterilir;
bir kaynak hatası önceki kayıtları silmez. Kapalı ilanlar otomatik arşivlenmez.

Eşleşmeler mevcut **İnceleme Bekleyenler** listesine gelir. Aynı kaynak/ilan kimliği
veya normalize edilmiş URL tekrar eklenmez; mevcut analiz veya Başvuruldu kaydı
üzerine yazılmaz. Başka platformlarda farklı URL ile yayımlanan aynı işin kesin
olarak birleştirilmesi bu sürümde yoktur. Keşif zamanı yayın tarihi değildir.
Kaynağın güncellenen ilan açıklaması mevcut kayıt üzerine otomatik yazılmaz.

Ülke/dil kesinleşmemiş ilanlarda `ZZ` yalnızca iç kayıt işaretidir. Panel bunu
“Ülke ve dil doğrulanmalı” olarak gösterir; CV, model analizi ve form başlatma
engellenir. İlanı okuyup ülke ve dili doğruladığında bu kapı açılır; ücretli analiz
ve kişisel bilgi paylaşımı için mevcut ayrı onaylar hâlâ gerekir. İlk teslimin dil
seçimi Türkçe/İngilizce ve ülke listesi paneldeki desteklenen ülkelerle sınırlıdır.

Keşif ayarları ve son rapor `.careerpilot/hub/discovery.json`, ilanlar mevcut özel
jobs dizininde saklanır. Keşif LLM veya ücretli API anahtarı kullanmaz. Bu sürümde
zamanlayıcı ve otomatik başlangıç yoktur; yalnızca düğmeye basıldığında çalışır.
Bilgisayar kapalıyken çalışma ve periyodik kontrol henüz eklenmedi.

Kaynak belgeler: [Greenhouse](https://docs.greenhouse.io/job-board.html),
[Lever](https://github.com/lever/postings-api).

### Eksik kaynak konumu

Kaynak ayarında isteğe bağlı **Eksik konum için şirket varsayılanı** alanı vardır.
`Full-time`, `Part-time`, `New Grad` gibi iş türleri coğrafi konum olarak kullanılmaz.
İlanın konumu boşsa doğruladığın şirket varsayılanı filtrede kullanılır; ilanın
kendi farklı konumu varsa onun üzerine yazılmaz. Eşleşme nedeninde bu bilginin
şirket varsayılanından geldiği görünür. Bu, ülke/dil doğrulamasını veya çalışma
hakkı kontrolünü otomatik tamamlamaz. Şirketin bütün ilanlarına sabit ülke atanmaz.


## Başlangıç seviyesi odağı ve kaynak arama hazırlığı

Keşif ayarlarındaki başlangıç seviyesi seçeneği varsayılan olarak açıktır.
Senior/Lead/Intermediate vb. başlıklar ve açık en az 3 yıl deneyim ifadeleri
elenir. Tercih edilen veya belirsiz deneyim ifadelerinden kesin bir uygunluk
kararı çıkarılmaz. New Grad/Junior başlıkları etiketlenip inceleme listesinde
öne alınır. Başlık ve metin çelişirse açık yüksek asgari deneyim şartı önceliklidir.
Bu kurallar bir adayın şartları sağladığını veya İngilizce/teknik yeterliliğini
kanıtlamaz. Seçenek kapanırsa kullanıcı başlık hariç tutma filtresi hâlâ uygulanır.

Varsayılan roller yazılım, veri/iş analizi ve BT denetimi ailelerini içerir.
Mevcut kaydedilmiş rol tercihleri otomatik değiştirilmez; ayarlardan genişletilebilir.
Mevcut ilanlar silinmeden güncel başlık/metinle etiketlenir; eski analiz skorları
elle değiştirilmez. Kaynak/panel kayıtları yeni alanlar için geriye uyumludur.

**Kaynak arama planını göster** kaydedilmiş kriterlerden en fazla 4 arama sorgusu
hazırlar. Bu sorgular çalıştırılmaz. Henüz otomatik kaynak arama sağlayıcısı veya
API anahtarı bağlanmadı; bu özellik şirketleri kendi kendine internette aramaz.
Sorgular yalnızca rol/konum içerir, aday profili/CV/iletişim bilgisi içermez.

**Birden fazla şirket kaynağını birlikte ekle** bölümüne kariyer/ilan bağlantıları
satır satır yapıştırılabilir. Program yalnızca desteklenen resmî host/yol yapılarından
kaynak kodlarını çıkarır, tekrarları ayıklar. Kaynak listesine toplam en çok 20 aday
eklenir. Bu adımda ağ isteği yapılmaz; kaynak etiketleri `Kaynak: kod` şeklindedir,
gerçek şirket adının doğrulandığı iddia edilmez. Kullanıcı listeyi gözden geçirip
kaydeder; resmî uç noktaya erişim normal keşif düğmesinde doğrulanır.

Gelecek otomatik arama bağlantısı için ayrı servis erişimi, sonuç saklama hakkı ve
ayrı istek/maliyet sınırı gerekir. Mevcut OpenAI bütçesi arama servisini kapsamaz.
İncelenen belgeler: [Brave Search API](https://brave.com/search/api/),
[fiyatlandırma](https://api-dashboard.search.brave.com/documentation/pricing).
Bu teslimde harici arama hesabı açılmadı veya ücretli servis çağrısı yapılmadı.


## SerpAPI ile şirket kaynağı bulma (isteğe bağlı)

[SerpAPI Free](https://serpapi.com/pricing) hesabı ayda 250 sorgu sunuyor
(19 Ekim 2026 kontrolü). Hesabındaki güncel planı/kotayı doğrula; ücretli plan,
kart veya ek kredi satın alma gerekmez. Anahtarını sohbet, ekran görüntüsü veya
Git dosyasına koyma. Mevcut özel `.env` dosyana `SERPAPI_API_KEY` ekle.
OpenAI anahtarı farklıdır; bu arama OpenAI modelini açmaz veya bütçesini kullanmaz.

Açık form oturumlarını tamamladıktan sonra paneli arama seçeneğiyle başlat:

```bash
npm run hub -- --port 3211 --enable-search
```

Panelde **İlan keşfet** → rol/konum ayarlarını kaydet → sorgu planını incele →
rol/konum paylaşımı ve ücretsiz kota onayını işaretle → **SerpAPI ile şirket
kaynaklarını bul**. Gelen kaynak adaylarını kontrol et; şirket adları yalnızca
kaynak kodundan etiketlenir. **Kaydet ve ilanları bul** resmî Greenhouse/Lever
okuyucusunu çalıştırır ve filtre eşleşmelerini inceleme listesine aktarır.
İlanın ülke/dil doğrulaması ve sonraki analiz/başvuru izinleri devam eder.

Arama en çok 4 sorgu/işlem, 8/gün, 200/UTC takvim ayıdır. Aynı sorguların başarılı
sonuçları 24 saat yerel kayıttan döner; yeni sorgular arasında 15 dakika beklenir.
Her koşu önce [ücretsiz Account API](https://serpapi.com/account-api) ile etkin
0 USD planı ve yeterli kalan kotayı doğrular. Hata, kota yetersizliği veya ücretli/
bilinmeyen plan aramayı durdurur; otomatik tekrar, plan yükseltme veya ödeme yoktur.
Yerel sayaç sağlayıcının gerçek bakiyesi değildir; başka uygulamaların tüketimi
sağlayıcı kontrolünde görülür. Sorgu rezervasyonları hata durumunda geri verilmez.
Her tamamlanan sorgunun kaynakları hemen saklanır. Sonraki sorgu başarısız
olursa panel kısmi sonuçları ve hata nedenini gösterir. Aynı aramanın önbelleği
kısmi olduğunu korur; eksik sorgular kendiliğinden tekrar edilmez. Arama isteği
başına süre sınırı 60 saniye, hesap kontrolü 15 saniyedir.
Arama yanıtları sınırlı okunur, sonuç hostları filtrelenir; CV veya kişisel profil
arama servisine gönderilmez. Yalnızca kaynak kodları ve yerel sayaç/önbellek saklanır.

Süreç çökerse `source-search.lock` kalabilir; çalışan panelleri kontrol edip
kapattıktan sonra yalnızca bu kilit klasörünü kaldır. Sayaç dosyasını silme.
Bu sürüm otomatik zamanlama yapmaz, internetteki tüm şirketleri kapsamaz; liste
20 kaynak ve her sorgunun ilk 10 organik bağlantısıyla sınırlıdır. Arama
servisindeki CAPTCHA yönetimi, başvuru sitelerindeki CAPTCHA'ları kaldırmaz.

Karar kaynakları: [Serper kota ve fiyatları](https://serper.dev/),
[Serper B2B şartı](https://serper.dev/terms),
[SerpAPI arama belgeleri](https://serpapi.com/search-api),
[SerpAPI şartları](https://serpapi.com/legal),
[Gemini model bazlı fiyatlar](https://ai.google.dev/gemini-api/docs/pricing).
Ücretsiz kotanın değişmeyeceği veya sonuçların eksiksiz olduğu garanti edilmez.

Keşif ekranı yerel günlük/aylık kalan hakkı ve yeni aramaya kalan süreyi gösterir.
Sayaç, SerpAPI hesabının gerçek bakiyesi değildir; sağlayıcı kontrolü arama
başlangıcında yapılır. Durum göstergesi dış servise istek yapmaz. Hazır olmayan
arama düğmesi pasiftir; süre dolunca açılır. Aynı kriterlerin önbellekteki sonuçları
bekleme sırasında da yeni sorgu tüketmeden alınabilir.


## Rol bazlı doğrudan ilan araması

Güncel panelde **İlan keşfet** ana akışı şirket seçmeden çalışır:

1. Rolleri ve filtreleri düzenle; Türkiye veya Global remote seç.
2. Rol/bölge paylaşımı ve ücretsiz kota kutusunu onayla.
3. **İlanları ara ve panele ekle** ayarları kaydeder ve en çok iki sorgu çalıştırır.
4. Sonuçlar tekil ilan URL'si ve başlık filtresinden geçip doğrudan
   **İnceleme Bekleyenler** listesine eklenir. Rapor incelenen/eklenen/tekrar/
   filtre dışı/geçersiz sayıları ayrı gösterir; şirket kaynağı eklemek gerekmez.
5. İlanı açıp açık olduğunu kontrol et; tam metni, şirketi, ülkeyi ve dili
   doğrulama alanına gir. Bu adımdan önce özet üzerinden analiz, CV seçimi veya
   form başlatma yapılamaz. Model varsayılan olarak kapalı kalır.

Bu özellik SerpAPI arama sonuçlarını kullanır, kişisel LinkedIn/Indeed/Kariyer.net
hesaplarını açmaz veya siteleri kazımaz. Sadece mevcut desteklenen platformların
tekil ilan adresleri kabul edilir. Şirket/liste sayfaları uygun ilan diye
aktarılmaz. İlan başlığı/özeti arama motorunun verisidir; başka ilanlardan metin
veya eski bilgi içerebilir. İlanın açık olduğu veya adayın şartları sağladığı
iddia edilmez. Tam ilan metni bu sürümde kullanıcı tarafından getirilir.

Arama bölgesi sorguya yön verir; ilanın gerçek çalışma ülkesi veya remote uygunluğu
otomatik doğrulanmaz. Aynı iş ID'sinin farklı LinkedIn ülke/başlık URL'leri
birleştirilir; farklı yayın ID'leri aynı işe ait olabilir ve insan kontrolü ister.
Mevcut başvuru durumları ve analizler üzerine yazılmaz.

Şirket kaynağı bulma ve resmî şirket listelerini tarama seçenekleri **Gelişmiş:
şirket kaynaklarını takip et** bölümüne taşındı. Kaynak araması en çok dört,
rol araması en çok iki sorgudur; toplam günlük 8 / aylık 200 sınırı ortaktır.
Önbellek arama türünü/bölgesini/rolleri ayırır; eski kaynak sonuçları doğrudan
ilan gibi aktarılmaz. Aynı aramanın önbelleği yeni sorgu harcamaz.
