# Verification Portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the diagnosed native source identity and Temporal fake-clock verification failures without changing business behavior.

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

- [ ] Add batch regressions retrieving distinct secondary sources via the exported conversion for Windows backslashes, Windows forward slashes, relative dot segments and POSIX absolute names. Assert secondary text and a plain AST-derived value; include malformed secondary diagnostic 1160. Preserve collision/lifetime assertions.
- [ ] Run the new regressions plus the two known consumer cases before the fix and capture relevant failures. A missing new export is not the only evidence: the unmodified approval and tenant cases must reproduce the lookup mismatch.
- [ ] Export/rename the normalizer and reuse it internally and at the two consumer lookups. Keep original filename metadata, diagnostic handling, candidate/owner checks and disposal behavior unchanged.
- [ ] Run `pnpm exec vitest run --project unit src/lib/typescript/native-source-analysis.test.ts src/lib/approvals/approval-write-boundary.test.ts src/app/api/tenant-mutation-scope.test.ts --maxWorkers 2` from apps/webapp. Run scoped Biome for changed files and `pnpm run typecheck`. All affected assertions should pass; diagnose any residual failure rather than changing expectations.
- [ ] Self-review and commit only the four task files with `fix(tooling): normalize native source batch lookups`. Report TDD evidence, exact commands/counts, changes and concerns to the controller's report file.

### Task 2: Isolate imported Temporal test clocks

**Files:** Modify apps/webapp/src/test/unit-setup.ts. Create apps/webapp/src/test/temporal-test-clock.ts and apps/webapp/src/test/temporal-test-clock.test.ts. Existing affected business test files remain validation inputs; change only a test's explicit clock injection when the existing API already supplies that seam and the shared view cannot correctly cover it, documenting why.

**Interfaces:** Produces `createTestTemporalNow(actual: typeof import("temporal-polyfill").Temporal, isFakeClockActive: () => boolean): typeof import("temporal-polyfill").Temporal.Now` in the helper. It returns a separate Now object; preserve descriptors where relevant. `instant`, `zonedDateTimeISO`, `plainDateTimeISO`, `plainDateISO`, `plainTimeISO` read fake Date.now afresh only while active; `timeZoneId` delegates. Outside fake time, delegate actual Now calls. Unit setup imports original module inside `vi.mock("temporal-polyfill", async importOriginal => ...)`, preserves exports/Temporal constructors and descriptors, and substitutes only a separate imported Now view. Detect `vi.isFakeTimers()` and fake Date constructor replacement for setSystemTime without timers; capture real Date before timer changes. Never change globalThis.Temporal or import temporal-polyfill/global.

- [ ] Reproduce existing birthday current-date and elapsed-timer failures. Add behavior regressions for 5 -> 6 seconds advancement, UTC date rollover, Date-only fake timers, setSystemTime without timers, fake -> real -> fake transition, default/requested zones at DST, identities/instanceof and global preservation. Check independent native/fallback-compatible Now view objects, and spy/reset isolation. Use real imported Temporal constructors and a controlled original Now fixture where exact delegation must be observable.
- [ ] Run the new focused tests red, preserving the existing business expectations. Do not compensate by patching production clocks.
- [ ] Implement the test helper and module-only mock, preserving afterEach/afterAll database refusal checks. Keep shared seam minimal; no global polyfill or production imports of test code.
- [ ] Run helper tests and all 11 affected suites listed in temporal-diagnosis.md; also onboarding/work-schedule/page.test.tsx and Schedule-X compatibility tests discovered by exact file search. Run scoped Biome and all configured typechecks. Report native/fallback coverage limits explicitly.
- [ ] Self-review and commit only task files with `test: align imported Temporal with fake clocks`. Report exact commands/counts, TDD evidence, global/identity checks, restoration and concerns.

## Controller verification and self-review

Both tasks are self-contained; no shared files or consumed interfaces. The plan maps all spec requirements and five review risks to focused checks. After task reviews, collect one full unit JSON and compare with the previous inventory; perform a bounded rerun/diagnosis for newly appearing or remaining clock/path failures. Broader portability work needs its own reviewed scope rather than weakening tests. Final whole-follow-up review covers only commits after the current dev base, not the already merged performance PR. Do not push, merge or ship this follow-up without user authorization.
