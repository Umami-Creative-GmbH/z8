# Verification Portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Repair diagnosed native source identity, Temporal fake-clock and platform fixture verification failures without changing business behavior.

**Architecture:** Export the existing lexical virtual-path conversion and use it at batch lookups. Add a test-only imported Temporal Now view that delegates real time normally and derives fake time from the active test boundary clock. These independent repairs share no production interfaces.

**Tech Stack:** TypeScript 7.0.2 native API, temporal-polyfill 1.0.4, Vitest 5, pnpm, Node 26 locally.

**Spec:** docs/superpowers/specs/2026-10-03-verification-portability.md

## Global Constraints

- Use pnpm and existing dependencies.
- No generated schema edits, translation edits, bulk formatting, timekeeping changes, tenant permission changes, runtime credentials or production interactions.
- Preserve original filename metadata, ownership and tenant checks, malformed-source diagnostics, alias-collision rejection, and callback/snapshot lifetime rules.
- Only replace the imported module's Now view. Preserve real Now behavior outside fake clocks, Temporal constructor identities and all other exports, requested/default zones, fresh clock reads, global Temporal, unit database refusal guards, and restoration between cases.
- No production clock changes or weaker assertions.
- Add meaningful behavioral regressions, verify affected suites and typechecks, and collect one final full unit inventory.

## Review Focus

1. Windows and relative secondary source names resolve to the virtual batch member, not only the entry. Task 1 retrieves distinct secondary text and a plain AST-derived result for four path forms.
2. Malformed secondary source and normalized collisions remain fail-closed. Task 1 verifies diagnostic 1160 and retains existing collision/lifetime suites.
3. Fake Date-only clocks and time changes without fake timers must control imported Temporal; real-clock restoration must remove fake time. Task 2 exercises all three transitions without altering global Temporal.
4. Near-midnight and DST instants use the requested zone, with default zone delegated. Task 2 pins epoch instants and local outputs around a transition.
5. Constructor/export identities and suite-local spy cleanup survive the test seam, including native and fallback-compatible Now objects. Task 2 checks identities and independent view creation/reset behavior.

## Execution context

Worktree Y:/Codex/Worktrees/2e38/z8; branch ai/563-verification-portability, base origin/dev 8bfee1c6b. User already selected subagent-driven execution and explicitly authorized these repairs. Controller owns tracker, branch switching, reviews and full-suite inventory. Workers never spawn agents, switch branches, push, open PRs or mutate production. Stage only task files and commit locally after scoped checks. Git metadata lies outside the writable worktree; git add/commit require escalation. Existing dependencies are installed; no reinstall. Read repository required references.

Native and Temporal diagnosis reports are copied into this plan's ignored SDD workspace by the controller. The inherited Vite native-config warning is unrelated; record it. A scoped Biome check may explicitly match existing CRLF checkout line endings without rewriting unrelated files. Phase credentials and authenticated Next runtime gates remain unavailable. Do not run the full unit suite per task; controller runs it once after both tasks.

### Task 1: Share native virtual filename identity

**Files:** Modify apps/webapp/src/lib/typescript/native-source-analysis.ts, apps/webapp/src/lib/approvals/approval-write-boundary-typescript.ts, apps/webapp/src/app/api/tenant-mutation-scope.test.ts. Test apps/webapp/src/lib/typescript/native-source-analysis.test.ts.

**Interfaces:** Produces `normalizeNativeSourceFileName(fileName: string): string` by exporting/renaming the current normalizeFileName algorithm unchanged. Consumes existing withNativeProgram and callback Program.getSourceFile. No new Program facade.

- [x] Add batch regressions retrieving distinct secondary sources via the exported conversion for Windows backslashes, Windows forward slashes, relative dot segments and POSIX absolute names. Assert secondary text and a plain AST-derived value; include malformed secondary diagnostic 1160. Preserve collision/lifetime assertions.
- [x] Run the new regressions plus the two known consumer cases before the fix and capture relevant failures. A missing new export is not the only evidence: the unmodified approval and tenant cases must reproduce the lookup mismatch.
- [x] Export/rename the normalizer and reuse it internally and at the two consumer lookups. Keep original filename metadata, diagnostic handling, candidate/owner checks and disposal behavior unchanged.
- [x] Run `pnpm exec vitest run --project unit src/lib/typescript/native-source-analysis.test.ts src/lib/approvals/approval-write-boundary.test.ts src/app/api/tenant-mutation-scope.test.ts --maxWorkers 2` from apps/webapp. Run scoped Biome for changed files and `pnpm run typecheck`. All affected assertions should pass; diagnose any residual failure rather than changing expectations.
- [x] Self-review and commit only the four task files with `fix(tooling): normalize native source batch lookups`. Report TDD evidence, exact commands/counts, changes and concerns to the controller's report file.

### Task 2: Isolate imported Temporal test clocks

**Files:** Modify apps/webapp/src/test/unit-setup.ts. Create apps/webapp/src/test/temporal-test-clock.ts and apps/webapp/src/test/temporal-test-clock.test.ts. Existing affected business test files remain validation inputs; change only a test's explicit clock injection when the existing API already supplies that seam and the shared view cannot correctly cover it, documenting why.

**Interfaces:** Produces `createTestTemporalNow(actual: typeof import("temporal-polyfill").Temporal, isFakeClockActive: () => boolean): typeof import("temporal-polyfill").Temporal.Now` in the helper. It returns a separate Now object; preserve descriptors where relevant. `instant`, `zonedDateTimeISO`, `plainDateTimeISO`, `plainDateISO`, `plainTimeISO` read fake Date.now afresh only while active; `timeZoneId` delegates. Outside fake time, delegate actual Now calls. Unit setup imports original module inside `vi.mock("temporal-polyfill", async importOriginal => ...)`, preserves exports/Temporal constructors and descriptors, and substitutes only a separate imported Now view. Detect `vi.isFakeTimers()` and fake Date constructor replacement for setSystemTime without timers; capture real Date before timer changes. Never change globalThis.Temporal or import temporal-polyfill/global.

- [x] Reproduce existing birthday current-date and elapsed-timer failures. Add behavior regressions for 5 -> 6 seconds advancement, UTC date rollover, Date-only fake timers, setSystemTime without timers, fake -> real -> fake transition, default/requested zones at DST, identities/instanceof and global preservation. Check independent native/fallback-compatible Now view objects, and spy/reset isolation. Use real imported Temporal constructors and a controlled original Now fixture where exact delegation must be observable.
- [x] Run the new focused tests red, preserving the existing business expectations. Do not compensate by patching production clocks.
- [x] Implement the test helper and module-only mock, preserving afterEach/afterAll database refusal checks. Keep shared seam minimal; no global polyfill or production imports of test code.
- [x] Run helper tests and all 11 affected suites listed in temporal-diagnosis.md; also onboarding/work-schedule/page.test.tsx and Schedule-X compatibility tests discovered by exact file search. Run scoped Biome and all configured typechecks. Report native/fallback coverage limits explicitly.
- [x] Self-review and commit only task files with `test: align imported Temporal with fake clocks`. Report exact commands/counts, TDD evidence, global/identity checks, restoration and concerns.

### Task 3: Make platform-sensitive test fixtures portable

**Files:** Modify only these 11 tests: apps/webapp/src/lib/auth-client.test.tsx; apps/webapp/src/lib/auth-security.test.ts; apps/webapp/src/db/__tests__/drizzle-migrations.test.ts; apps/webapp/src/db/__tests__/employee-owner-lifecycle-migration.test.ts; apps/webapp/src/lib/auth/explicit-organization-action-coverage.test.ts; apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts; apps/webapp/src/components/ui/base-ui-wrapper-source.test.ts; apps/webapp/src/lib/datetime/temporal-source-guard.test.ts; apps/webapp/src/lib/approvals/approval-write-boundary.test.ts; apps/webapp/src/lib/calendar/work-period-service.test.ts; apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx. A tiny test-only text reader is allowed if it reduces repeated normalization without widening the change.

**Interfaces:** Consume existing scanner and component APIs unchanged. Normalize only test-read CRLF to LF and test relative-path backslashes to slashes. Use process.platform === "win32" ? "junction" : "dir" for real absolute-target directory links. Retain real POSIX file symlink coverage; on Windows adapt only the file-shaped fixture's lstat result. Replace chmod read denial with target-only openSync EACCES injection, preserving/restoring all other real filesystem behavior in finally. No production filesystem seam. Fixture assertions retain exact finding shape, one interception, exclusion, and outside-target integrity.

- [x] Reproduce 15 named source/path assertions and four approval fixture failures from remaining-guards-diagnosis.md, plus the AM whitespace and manual server-rejection cases in task-2-report.md. Existing expectations are the red regression; no new mirrored normalization tests needed.
- [x] Normalize text at shared test read ingress, covering direct SQL reads as well as migration helpers before marker slicing/mutation generation. Preserve all other whitespace/tokens, SQL parity and negative assertions; do not change SQL, generated schema, source files or allowlists.
- [x] Normalize relative paths only at exact allowlist/spy result projections. Verify in-memory forbidden Radix hook and global Temporal import controls still fail after normalization. Do not weaken scanner detectors.
- [x] Repair approval fixtures with real Windows junctions targeting a test-owned outside directory; assert root rejection, nested link exclusion and outside source intact. Use a target-only test filesystem spy/module adapter for the unavailable Windows file-link branch and unreadable-file EACCES. Restore adapters and owned fixture state in finally, confirm each targeted interception, preserve complete existing error findings and all exclusion/ownership assertions. Never skip these cases; validate mock binding in Vitest.
- [x] Normalize Unicode whitespace only in the localized 8:00 AM assertion in work-period-service.test.ts. Supply existing defaultClockInTime="09:00" and defaultClockOutTime="17:00" props only in the manual dialog's server-rejection context-refresh fixture; keep the server-call/rejection/refetch assertions unchanged.
- [x] Run the 11 affected test files, with bounded failures/commands in the report, then scoped Biome using checkout line endings and all configured typechecks. Production source unchanged; investigate rather than suppress remaining failures. Preserve inherited Vite warning in evidence.
- [x] Self-review and commit only this fixture batch with `test: make source guards and failure fixtures portable`. Report red/green evidence, real junction checks, restoration/isolation and platform limits to the controller.

### Task 4: Separate server-action import setup from surface assertions

**Files:** Modify only apps/webapp/src/app/[locale]/(app)/time-tracking/actions.server-action-surface.test.ts.

**Interfaces:** Move the identical real `await import("./actions")` to top-level collection scope, matching the existing actions.canonical.test.ts pattern. Keep all four runtime absence assertions and both source-module assertions unchanged. No mock, production edit, persisted timeout increase or database guard change.

- [x] Read action-surface-timeout-diagnosis.md in the owned workspace. Existing full and single-worker runs already reproduce the 5,000 ms timeout. The diagnostic-only 30-second run settles in 6,855 ms with all three assertions passing; its environment-scrub preparation failed, so do not claim that run scrubbed inherited variables.
- [x] Move only the real namespace import out of the test callback into collection setup. Preserve the tested runtime namespace and assertions. This is a test arrangement repair, not an application import optimization.
- [x] Run this file with the normal timeout and one worker, then the three earlier timeout files together with one worker; do not run another full inventory. Run scoped Biome with checkout line endings and all configured typechecks. No credentials, weakening assertions or warning suppression.
- [x] Self-review and commit only this test with `test: initialize server action surface before assertions`. Report exact commands/counts, import arrangement, normal-budget checks and limits.

## Controller verification and self-review

All three tasks are self-contained. Task 3 modifies tests that validate Tasks 1 and 2 but consumes their production interfaces unchanged; sequential execution avoids races in those test files. Task 3's diagnosed fixtures and negative controls extend the source/collision and restoration review focus. After task reviews, collect one full unit JSON and compare with the previous inventory; perform a bounded rerun/diagnosis for newly appearing or remaining clock/path failures. Broader portability work needs its own reviewed scope rather than weakening tests. Final whole-follow-up review covers only commits after the current dev base, not the already merged performance PR. Do not push, merge or ship this follow-up without user authorization.
