# Task 2.1 Important Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Task 2.1 authorization, actor, Temporal, chronology, materialization, metadata, lineage, and hostile-input findings without implementing persistence or orchestration.

**Architecture:** Put opaque cancellation capability identity in a dependency-free workflow module backed by a private WeakMap, while the domain adapter remains the only production mint caller. Keep the state machine pure and fail-closed by validating and cloning untrusted graph data before access, with all time checks using branded Temporal Instants.

**Tech Stack:** TypeScript, Temporal polyfill, Vitest, Biome, pnpm.

---

### Task 1: WeakMap cancellation capability

**Files:**
- Create: `apps/webapp/src/lib/approvals/workflow/approved-cancellation-capability.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/approved-cancellation-capability.test.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/types.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/ports.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/contracts.typecheck.ts`

- [ ] Write tests proving lookalikes, spreads, copied properties/symbols, `Object.create`, and wrong scope fail; add a source-boundary test permitting the internal mint import only from domain adapter types.
- [ ] Run focused tests and record RED.
- [ ] Add a compile-time unique-symbol brand with private `WeakMap<object, Readonly<{ organizationId: string; workflowId: string }>>`; export public type/verifier and an `@internal` minter.
- [ ] Move terminal transition capability types to the lower workflow layer and remove workflow-to-domain imports.
- [ ] Run focused tests and contract typecheck for GREEN.

### Task 2: Canonical command actors and v1 fingerprints

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/ports.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/contracts.typecheck.ts`

- [ ] Write RED tests for null/empty employee user IDs, same-employee fingerprint equality across user context, stable system fingerprint, and physical actor mapping.
- [ ] Define command actors as employee with canonical `employeeId` plus non-empty `userId`, or system with both IDs null.
- [ ] Emit durable fingerprints as `v1:` plus a collision-safe canonical tuple based on employee ID only, or the stable system tuple.
- [ ] Document the Task 2.3 trusted organization-membership resolution requirement at the receipt boundary.
- [ ] Run focused tests and typecheck for GREEN.

### Task 3: Temporal Instant runtime brand

**Files:**
- Modify: `apps/webapp/src/lib/datetime/temporal-core.ts`
- Modify: `apps/webapp/src/lib/datetime/temporal-core.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.ts`

- [ ] Write RED tests rejecting coercible objects and `Temporal.ZonedDateTime` while accepting real Instants.
- [ ] Export `isInstant(value): value is Instant` by invoking the Temporal Instant prototype `epochNanoseconds` getter against the candidate without coercion.
- [ ] Replace state-machine comparison-as-brand checks with `isInstant` for all ingress timestamps.
- [ ] Run temporal-core and state-machine tests for GREEN.

### Task 4: Closing chronology and lineage chronology

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.test.ts`

- [ ] Write RED tests for future-dated siblings during approve/reject and future pending assignments during cancel/expire.
- [ ] Add one pre-close traversal that verifies every affected pending stage activation and assignment timestamp before mutation.
- [ ] Write a RED test for a descendant assigned before its cancelled source was resolved, plus a valid incomplete legacy case.
- [ ] Require `descendant.assignedAt >= source.resolvedAt` only when lineage is present.
- [ ] Run focused chronology tests for GREEN.

### Task 5: Fail-closed materialization plans

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.test.ts`

- [ ] Write RED mutation tests for absent events, null arrays, malformed planned stages/assignments/changes, unknown references/actors, and wrong versions/indexes.
- [ ] Validate the full plan graph before materialization access: snapshot, changes, allocations, events, references, actors, JSON, timestamps, scope, versions, and contiguous event indexes.
- [ ] Require at least one event and coherent root/stage/assignment change coverage.
- [ ] Ensure every malformed plan exits as `MATERIALIZATION_CONFLICT`, never a native exception.
- [ ] Run materialization tests for GREEN.

### Task 6: Exact metadata envelope and single-pass JSON cloning

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.test.ts`

- [ ] Write RED envelope tests for extra envelope keys, empty references, contradictory null flags, and business keys accompanying a null flag.
- [ ] Enforce exact `{ businessMetadataWasNull, references }` envelope keys, non-empty supported references, and lossless business metadata hydration.
- [ ] Write RED tests using stateful and revoked proxies.
- [ ] Replace validate-then-clone with one descriptor-based guarded traversal that clones as it validates and maps reflection failures to stable domain errors.
- [ ] Run codec and hostile JSON tests for GREEN.

### Task 7: Full verification

**Files:**
- Verify all modified files only; do not alter schema, migrations, generated auth schema, or persistence/orchestration modules.

- [ ] Run targeted state-machine tests.
- [ ] Run workflow tests and temporal-core tests.
- [ ] Run the full approvals regression suite.
- [ ] Run dedicated workflow and full application typechecks.
- [ ] Run Biome on modified files.
- [ ] Run `git diff --check` and inspect status/diff without touching unrelated work.
- [ ] Report RED/GREEN evidence, files, design details, and residual Task 2.2/2.3 risks; do not commit.
