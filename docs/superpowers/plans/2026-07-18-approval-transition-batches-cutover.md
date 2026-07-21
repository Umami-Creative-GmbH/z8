# Approval Transition Batches And Cutover Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automatic activation batches replayable through command receipts and prevent canonical command execution before canonical state is authoritative.

**Architecture:** The engine retains each independently persisted materialized transition pass and gives the ordered non-empty batch to the result builder. Receipt validation accepts consecutive version groups with per-version event indexes. The write gate rejects non-canonical authority before receipt reservation or domain mutation; canonical mode mirrors to legacy and complete mode does not.

**Tech Stack:** TypeScript, Vitest, Drizzle/PostgreSQL repository codec, existing approval transition engine and cutover ports.

**Constraints:** Work only in `/home/kai/projekte/z8/.worktrees/approval-workflow-rewrite`. Do not commit, add migrations, collapse CAS versions, renumber durable events, change legacy observation behavior, or continue the Phase 3.3 database resolver until this plan is complete.

---

## File Map

- Modify `apps/webapp/src/lib/approvals/workflow/ports.ts`: change the result-builder input to an ordered non-empty materialized transition batch.
- Modify `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`: enforce canonical authority early and retain each materialized activation pass.
- Modify `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`: cover batch construction, all events/outbox, and lifecycle authority.
- Modify `apps/webapp/src/lib/approvals/workflow/repository.ts`: validate multi-version receipt event groups without altering event identity.
- Modify `apps/webapp/src/lib/approvals/workflow/repository.test.ts`: cover valid round trips and malformed version/index groups.
- Modify `apps/webapp/src/lib/approvals/workflow/transition-engine.integration.test.ts`: prove a multi-pass command persists and replays atomically in PostgreSQL.

### Task 1: Make Command Receipt Events Multi-Version Safe

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.test.ts`

- [x] **Step 1: Write failing codec tests**

Build a result whose final snapshot is version 6 and whose ordered events are `(5,0)`, `(5,1)`, `(6,0)`. Assert `encodeApprovalCommandResult` and `decodeApprovalCommandResult` preserve the exact versions and indexes:

```ts
const result = commandResultAtVersion(6);
result.events = [
  { ...result.events[0]!, version: 5, eventIndex: 0 },
  { ...result.events[0]!, id: eventIdTwo, version: 5, eventIndex: 1 },
  { ...result.events[0]!, id: eventIdThree, version: 6, eventIndex: 0 },
];
result.outbox = result.events.map((event) => outboxFor(event));

expect(decodeApprovalCommandResult(encodeApprovalCommandResult(result))).toEqual(result);
```

Add table cases rejecting version order `[6,5]`, skipped versions `[4,6]`, a repeated group `[5,6,5]`, an initial index other than zero, a per-version index gap, and a last event version different from the final snapshot version.

- [x] **Step 2: Run codec tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/repository.test.ts -t "multi-version command result"
```

Expected: the valid multi-version case fails with `codec_failure` because current validation requires every event to use the final snapshot version and global array index.

- [x] **Step 3: Replace the single-version event invariant**

In `assertCommandResult`, keep event shape, actor, JSON, organization, workflow, and outbox-reference validation. Replace `event.version === result.snapshot.version && event.eventIndex === index` with one pass over ordered events:

```ts
let previousVersion: number | null = null;
let expectedEventIndex = 0;
for (const event of result.events) {
  if (event.version < 1) {
    fail("codec_failure", { field: "event.version" });
  }
  if (previousVersion === null || event.version === previousVersion + 1) {
    expectedEventIndex = 0;
  } else if (event.version !== previousVersion) {
    fail("codec_failure", { field: "event.sequence" });
  }
  if (event.eventIndex !== expectedEventIndex) {
    fail("codec_failure", { field: "event.sequence" });
  }
  previousVersion = event.version;
  expectedEventIndex += 1;
}
if (previousVersion !== result.snapshot.version) {
  fail("codec_failure", { field: "event.version" });
}
```

Initialize `expectedEventIndex` correctly when staying in the same group: increment after each event, and reset only when the version advances exactly one. Reject an empty command-result event array with `codec_failure`; every accepted command produces at least one transition event.

- [x] **Step 4: Run repository tests and confirm GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/repository.test.ts
```

Expected: PASS for existing single-version receipts, exact multi-version round trips, and all malformed sequence cases.

### Task 2: Pass Ordered Materialized Batches To The Result Builder

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/ports.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`

- [x] **Step 1: Write the failing batch regression**

Update the engine test result builder to capture an ordered batch. For a command that requests one automatic activation, assert:

```ts
expect(resultBuilderInputs[0]?.materializedBatch.map((pass) => pass.resultingSnapshot.version))
  .toEqual([8, 9]);
expect(result.events.map((event) => [event.version, event.eventIndex]))
  .toEqual([[8, 0], [8, 1], [9, 0], [9, 1]]);
expect(result.outbox.map((item) => item.eventId)).toEqual(result.events.map((event) => event.id));
```

The fixture builder must build the final snapshot/projection from `materializedBatch.at(-1)!`, flatten `pass.events` in batch order, and create outbox records for every flattened event.

- [x] **Step 2: Run the focused engine test and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts -t "retains every activation pass"
```

Expected: FAIL because the port accepts one `materialized` value and the current merged-event object loses pass boundaries.

- [x] **Step 3: Define and populate the non-empty batch**

Change the result-builder port:

```ts
export interface ApprovalTransitionResultBuilder {
  build(input: {
    materializedBatch: readonly [
      ApprovalMaterializedTransitionPlan,
      ...ApprovalMaterializedTransitionPlan[],
    ];
    finalization: ApprovalTerminalFinalizationResult | null;
  }): ApprovalCommandResult;
}
```

In the engine, remove the synthetic `{ ...materialized, events: materializedEvents }`. Start with:

```ts
let materialized = await materializeAndApply(plan, actor);
const materializedBatch: [
  ApprovalMaterializedTransitionPlan,
  ...ApprovalMaterializedTransitionPlan[],
] = [materialized];
```

After each activation pass, push `activationMaterialized` before assigning it to `materialized`. Call the result builder with `{ materializedBatch, finalization }`.

- [x] **Step 4: Update every local result-builder fixture**

Update transition-engine unit and integration fixture builders to use the last batch item for the final snapshot and flatten all events for `ApprovalCommandResult.events` and outbox. Do not renumber event versions or indexes.

- [x] **Step 5: Run engine tests and confirm GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts
```

Expected: PASS with one CAS/apply per pass, final snapshot from the last pass, and complete ordered event/outbox results.

### Task 3: Enforce Canonical Decision Authority

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`

- [x] **Step 1: Write failing lifecycle-mode tests**

Parameterize the engine fixture's gate result and assert `legacy`, `shadow`, and `ready` reject before `claimCommand`, `preflightCommand`, CAS, finalization, projection, outbox, compatibility, or receipt completion. Add positive cases:

```ts
it("executes canonical authority and mirrors canonical to legacy once", async () => {
  const fixture = engineFixture({ mode: "canonical" });
  await fixture.engine.execute(engineRequest());
  expect(fixture.calls.filter((call) => call === "compatibility")).toHaveLength(1);
});

it("executes complete authority without legacy mirroring", async () => {
  const fixture = engineFixture({ mode: "complete" });
  await fixture.engine.execute(engineRequest());
  expect(fixture.calls).not.toContain("compatibility");
});
```

- [x] **Step 2: Run lifecycle tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts -t "canonical authority"
```

Expected: non-authoritative modes currently continue into command execution.

- [x] **Step 3: Fail closed immediately after gate acquisition**

After acquiring and scope-checking the gate, reject unless both flags are true:

```ts
if (!gate.behavior.decideCanonical || !gate.behavior.writeCanonical) {
  throw engineError("forbidden", {
    field: "canonical_authority",
    mode: gate.mode,
  });
}
```

Place this before receipt construction and `claimCommand`. Restore `materializeAndApply` to unconditional CAS and `applyMaterializedTransition`; canonical authority has already been established. Trigger compatibility only for:

```ts
if (gate.behavior.mirror === "canonical_to_legacy") {
  await context.compatibilityWriter.mirrorCanonicalToLegacy({ result });
}
```

Do not call `mirrorLegacyToCanonical` from this engine.

- [x] **Step 4: Run transition-engine and cutover suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/workflow/transition-engine.test.ts \
  src/lib/approvals/workflow/cutover.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts
```

Expected: PASS for all lifecycle modes, canonical-to-legacy mirror direction, and unchanged legacy-to-canonical observation behavior.

### Task 4: Prove PostgreSQL Receipt Replay And Atomicity

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.integration.test.ts`

- [x] **Step 1: Add a multi-pass PostgreSQL integration case**

Seed a pending workflow where approving the current assignment activates an auto-approved next stage. Use a canonical rollout row and a resolver result of `requester_auto_approve`. Execute once, then execute the identical request again.

Assert both results are deeply equal; workflow version advances for the command and activation passes; persisted events contain both consecutive versions with indexes restarting at zero; the receipt is completed once; and source finalization occurs exactly once.

- [x] **Step 2: Run the integration case**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.integration.test.ts
```

Expected with a configured disposable PostgreSQL 16 database: PASS. If the suite's existing environment guard skips because no disposable database is configured, record the skip and rely on the existing CI PostgreSQL 16 job; do not connect to a shared database.

- [x] **Step 3: Run the complete focused verification**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/workflow/repository.test.ts \
  src/lib/approvals/workflow/transition-engine.test.ts \
  src/lib/approvals/workflow/cutover.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/workflow/ports.ts \
  src/lib/approvals/workflow/repository.ts \
  src/lib/approvals/workflow/repository.test.ts \
  src/lib/approvals/workflow/transition-engine.ts \
  src/lib/approvals/workflow/transition-engine.test.ts \
  src/lib/approvals/workflow/transition-engine.integration.test.ts
git diff --check
```

Expected: focused tests, typecheck, static checks, and diff check pass.

- [x] **Step 4: Perform final security and transaction review**

Verify non-authoritative modes fail before receipt reservation and source mutation; each batch pass has one CAS and one apply; receipt replay preserves every durable event identity; outbox references all batch events; and any failure still rolls back the caller-owned transaction.
