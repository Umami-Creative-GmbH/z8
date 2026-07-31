# React Doctor Bug Data Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove actionable unchecked-response and unsafe-JSON React Doctor warnings while preserving existing API error contracts and organization scoping.

**Architecture:** Harden each external or persisted data boundary at its owning module. HTTP clients must branch on `response.ok` before treating response data as success, while APIs with structured error bodies retain those bodies. Persisted skill-history JSON is parsed once through a Zod schema and malformed historical data becomes the service's typed failure instead of an untyped `SyntaxError`.

**Tech Stack:** TypeScript, React Query, Effect, Zod 4, Vitest, React Doctor 0.9.2, pnpm.

---

Implementation changes remain unstaged in the existing worktree.

### Task 1: Approval Inbox Mutation Responses

**Files:**
- Modify: `apps/webapp/src/lib/query/use-approval-inbox.ts:113-130`
- Test: `apps/webapp/src/lib/query/use-approval-inbox.test.ts`

- [ ] Add failing tests for approve and reject responses where HTTP status is non-2xx and the body is `{ success: false, error: "stale" }`; preserve that structured result instead of treating it as success or throwing a JSON parse error.
- [ ] Introduce one local response reader that checks `response.ok` before the success-body path, safely parses a structured failure body, and returns `{ success: false, error }` with the existing fallback message for malformed bodies.
- [ ] Use the reader from both `approveApproval` and `rejectApproval`; do not alter endpoint paths, methods, headers, or reason payload.
- [ ] Run `pnpm test -- src/lib/query/use-approval-inbox.test.ts`, `pnpm typecheck`, and the pinned scanner.

### Task 2: Personio API Response Status

**Files:**
- Modify: `apps/webapp/src/lib/payroll-export/exporters/personio/api-client.ts:52-97,115-164`
- Create: `apps/webapp/src/lib/payroll-export/exporters/personio/api-client.test.ts`

- [ ] Add failing tests for authentication and authenticated requests covering non-2xx JSON, non-JSON error bodies, 429/408/5xx retryability, and successful payloads.
- [ ] Read response text after receiving status, parse JSON safely, and branch on `response.ok` before accessing a success payload.
- [ ] Preserve `PersonioApiError.statusCode`, `isRetryable`, `errorCode`, timeout handling, token caching, and redacted logging behavior.
- [ ] For malformed non-2xx bodies, use `HTTP <status>`; for malformed 2xx bodies, return a non-retryable typed response error rather than leaking `SyntaxError`.
- [ ] Run the new test, `pnpm typecheck`, and the pinned scanner.

### Task 3: Telegram HTTP Failure Handling

**Files:**
- Modify: `apps/webapp/src/lib/telegram/api.ts:32-66`
- Create: `apps/webapp/src/lib/telegram/api.test.ts`

- [ ] Add failing tests for non-2xx Telegram JSON errors, non-JSON HTTP failures, successful payloads, and token redaction in logged metadata.
- [ ] Check `response.ok` before the success path. Preserve Telegram's structured `{ ok: false }` payload when available; synthesize `{ ok: false, error_code: response.status, description: "HTTP <status>" }` for malformed HTTP failures.
- [ ] Do not expose the full bot token in errors or logs and do not change exported wrapper return contracts.
- [ ] Run the new test, `pnpm typecheck`, and the pinned scanner.

### Task 4: Turnstile Response Validation

**Files:**
- Modify: `apps/webapp/src/lib/turnstile/verify.ts:19-42`
- Create: `apps/webapp/src/lib/turnstile/verify.test.ts`

- [ ] Add failing tests for non-2xx JSON, non-JSON failures, a 2xx `{ success: false, error }`, and a successful response.
- [ ] Check `response.ok` before accepting success. Return the existing `{ success: false, error: "Verification failed." }` fallback for malformed data or network errors and preserve a structured server error string when present.
- [ ] Keep the token-only request body and same-origin endpoint unchanged.
- [ ] Run the new test, `pnpm typecheck`, and the pinned scanner.

### Task 5: Skill Override History JSON

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/skill.service.ts:1027-1054`
- Create: `apps/webapp/src/lib/effect/services/skill.service.test.ts`

- [ ] Add failing service tests for valid `string[]`, malformed JSON, and valid JSON with a non-string-array shape in `missingSkillIds`; retain the organization-scoped history and skill queries.
- [ ] Define a local Zod `string[]` schema and a parser that reads each override's `missingSkillIds` exactly once.
- [ ] Convert malformed persisted history into the service's existing typed database/query failure channel with override context; do not throw a raw `SyntaxError` or silently discard IDs.
- [ ] Reuse parsed IDs for both the skill-ID set and `missingSkillNames` mapping.
- [ ] Run the new test, `pnpm typecheck`, and the pinned scanner.

### Task 6: Validate Data Boundary Findings

**Files:**
- Verify all files from Tasks 1-5.

- [ ] Run Biome on only changed files.
- [ ] Run all five focused suites together and `pnpm typecheck`.
- [ ] Run `git diff --check`.
- [ ] Run `pnpm dlx react-doctor@0.9.2 --json --yes > /tmp/diagnostics-bug-data-boundaries-after.json`.
- [ ] Confirm actionable `no-fetch-response-used-without-status-check` findings are gone from the five modules and `no-unsafe-json-parse` is gone from `skill.service.ts`.
- [ ] Retain occurrence-level false-positive classifications for intentional error-body parsing in `public/lib/sync-service.js`, `today-approvals-panel.tsx`, and `skill-catalog-management.tsx`.
