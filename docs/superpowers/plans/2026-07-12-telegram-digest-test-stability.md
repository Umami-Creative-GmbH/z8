# Telegram Digest Test Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Telegram digest concurrency coverage within Vitest's default five-second timeout during the complete webapp suite.

**Architecture:** Load the already mocked database and digest module when Vitest evaluates the test file, rather than inside individual test bodies. Production code and test timeout settings remain unchanged.

**Tech Stack:** Vitest 4, TypeScript 6, pnpm

## Global Constraints

- Do not change production Telegram digest behavior.
- Do not increase Vitest timeout limits.
- Preserve organization-scoped test inputs and assertions.
- Stage only the Telegram test and this plan; preserve concurrent locale-layout changes.

---

### Task 1: Move Mocked Module Loading Outside Timed Tests

**Files:**
- Modify: `apps/webapp/src/lib/telegram/jobs/daily-digest.test.ts`
- Create: `docs/superpowers/plans/2026-07-12-telegram-digest-test-stability.md`

**Interfaces:**
- Consumes: mocked `db` from `@/db` and `processTelegramBotDigest` from `./daily-digest`.
- Produces: the same five behavioral tests without dynamic module imports inside their timeout windows.

- [ ] **Step 1: Preserve the failing-suite evidence**

The complete webapp suite already failed with:

```text
daily-digest.test.ts > sends once when concurrent runs compete for the same recipient digest
Error: Test timed out in 5000ms.
```

The isolated verbose run showed the first case taking about 2.36 seconds while subsequent cases took 3–7 milliseconds, locating the cost in its first dynamic import.

- [ ] **Step 2: Add static mocked imports**

Add after the Vitest import:

```ts
import { db } from "@/db";
import { processTelegramBotDigest } from "./daily-digest";
```

Vitest hoists the existing `vi.mock` calls, so these imports resolve to mocked dependencies.

- [ ] **Step 3: Remove repeated dynamic imports**

Delete every occurrence of:

```ts
const { db } = await import("@/db");
```

and:

```ts
const { processTelegramBotDigest } = await import("./daily-digest");
```

Keep all mock setup, calls, dates, organizations, and assertions unchanged.

- [ ] **Step 4: Run the test with per-case timing**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/lib/telegram/jobs/daily-digest.test.ts --reporter=verbose
```

Expected: five passing tests; the concurrency case no longer includes module transformation time.

- [ ] **Step 5: Run the complete webapp suite**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: the Telegram concurrency test does not time out. Report any unrelated failures separately.

- [ ] **Step 6: Run static validation**

Run:

```bash
pnpm --dir apps/webapp exec tsc --project tsconfig.typecheck.json --noEmit --incremental false
git diff --check
```

Expected: both commands exit successfully.

- [ ] **Step 7: Commit only scoped files**

```bash
git add apps/webapp/src/lib/telegram/jobs/daily-digest.test.ts docs/superpowers/plans/2026-07-12-telegram-digest-test-stability.md
git commit -m "test: stabilize Telegram digest concurrency coverage"
```

