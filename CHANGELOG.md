# Changelog

## 0.1.0-beta.1 — 2026-10-20

First labelled beta baseline for individual local use.

- Local dashboard for job review, evidence-based analysis and application tracking.
- User-triggered discovery through FreeHire, quota-controlled search and configured
  Greenhouse/Lever feeds, with quality checks and partial-result preservation.
- Bilingual role groups, including software/data, IT audit, finance/accounting and
  marketing; separate general/finance CV and factual letter selection.
- Supervised assistance for supported forms, with destination-specific consent.
- Persistent model budgets and per-analysis approval; no paid requests at startup.
- `npm start`, offline mode, fictional demo and linked English/Turkish documentation.
- Portfolio presentation without an open-source licence (`UNLICENSED`).

### Validation and limits

The beta baseline has 170 passing offline tests plus separately recorded live
checks. This does not prove compatibility with every live hiring site. See
`docs/PROJECT_STATUS.md` for the scope of the live checks.

The dashboard is local, not a hosted service. Discovery is bounded, not exhaustive.
Login, CAPTCHA, legal consent and final submission remain human-controlled.
Workday/LinkedIn Easy Apply lack verified native end-to-end support; Greenhouse
filling/upload is not implemented. Scores are evidence coverage, not hiring odds.

The repository remains private pending the owner's GitHub support request about
old pull-request references. Historical author/committer emails were replaced
with the GitHub noreply address in branch history; old GitHub PR references may
still retain the previous commits. Private profiles, documents, credentials and
accounting records are not release assets.
