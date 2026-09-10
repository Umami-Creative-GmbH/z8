# Approval Maintenance CLI Implementation Plan

> **For agentic workers:** Use executing-plans for inline execution. Do not delegate unless explicitly requested.

**Goal:** Let server operators list organization-scoped approvals and force-delete a broken approval lifecycle by ID.

**Architecture:** A CLI parses input and manages the existing database pool; a separate SQL module performs source-independent listing and transactional cleanup. Root package aliases forward to webapp package scripts.

**Tech Stack:** TypeScript, Node.js, pnpm, Drizzle/PostgreSQL, Vitest.

---

## User-directed verification scope

The user requested no tests and no database verification. Implement inline and review the diff only. Do not run the CLI against any database or introduce a new test suite.

### Task 1: CLI contract

File: `apps/webapp/scripts/approvals.ts`.

- [x] Implement strict parsing; reject missing organization, malformed UUID, duplicate flags, unknown options, and ID supplied to list.
- [x] Support help without credentials, lazy database loading, and pool cleanup in `finally`, preserving the original command failure.

### Task 2: Transactional database operations

Files: `apps/webapp/scripts/approval-maintenance.ts`, `apps/webapp/src/lib/approvals/approval-write-boundary.ts`, `apps/webapp/src/lib/approvals/approval-write-boundary.test.ts`.

- [x] Implement a parameterized union for listing and exact-ID lookup, with UTC output and deterministic ordering.
- [x] Lock approval topology tables; recursively resolve the connected lifecycle using only explicit stage/request and chain/request links within the selected organization.
- [x] Clear source approval references, delete linked chains/requests, and delete workflows with existing FK cascades. Return deleted IDs only after the transaction commits.
- [x] Register exact maintenance write capabilities and keep the existing guard's owner-map expectations in sync.

### Task 3: Package commands, documentation, verification

Files: `package.json`, `apps/webapp/package.json`, `docs/refs/approval-maintenance.md`.

- [x] Add `approvals:list` and `approvals:delete` to both manifests; root scripts use `pnpm --filter webapp` and webapp scripts use `TZ=UTC tsx scripts/approvals.ts list|delete`.
- [x] Document commands, credential boundary, exact deletion scope, source-status preservation, and failure behavior.
- [x] Review `git diff --check` and the final diff. Do not commit unless requested. Report that tests and runtime verification were intentionally skipped.
