# Security and private data

CareerPilot is a local beta. Do not expose the dashboard to the public internet
or treat it as a hosted multi-user service. Keep the loopback-only setup.

## Reporting a concern

Do not post API keys, real profiles, CVs, application answers, browser sessions,
personal screenshots or raw logs in public issues or pull requests. Contact the
repository owner privately before sending sensitive details. No dedicated
security support service or response-time guarantee is provided.

A useful non-sensitive report includes the affected feature, reproduction steps
using fictional data, the safe error code and expected versus actual behaviour.

## Before sharing a copy or screenshot

- Keep `.env`, `.careerpilot/`, personal documents and browser profiles private.
- Use `npm run hub -- --demo` for public screenshots; its data is fictional.
- Inspect the complete image and terminal output before uploading them.
- If a real key has been disclosed, revoke/rotate it at the provider. Removing
  it from the current file alone does not remove historical copies.
- Back up private state securely. Never delete budget/search ledgers to work
  around spending limits or cooldowns.

Automated checks and previous content scans cover only their stated scope.
They do not guarantee that every secret, vulnerability or personal detail has
been found. This document does not change consent requirements in the product.
