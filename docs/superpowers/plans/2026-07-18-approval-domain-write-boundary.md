# Approval Domain Write Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the transaction-bound rollout coordinator and static write-ownership guard required before migrating production domains to approval adapters.

**Architecture:** A generic coordinator enforces legacy, shadow/ready observation, and canonical-authority behavior inside an existing transaction. A TypeScript/SQL source analyzer inventories protected approval-table writes and checks them against exact path/table/operation ownership rules. Existing domain writers remain explicit temporary exceptions until their adapters replace them.

**Tech Stack:** TypeScript, Vitest, TypeScript compiler API, existing PostgreSQL SQL lexer/evaluator patterns, approval write-gate and compatibility ports.

**Constraints:** Work only in `/home/kai/projekte/z8/.worktrees/approval-workflow-rewrite`. Do not commit, migrate production domain entrypoints, create adapters, add schema changes, or silently permit shadow writes without observation.

---

## File Map

- Create `apps/webapp/src/lib/approvals/domain-adapters/legacy-write-coordinator.ts`: rollout-aware transaction-bound legacy mutation coordinator and typed boundary error.
- Create `apps/webapp/src/lib/approvals/domain-adapters/legacy-write-coordinator.test.ts`: lifecycle ordering, scope, observation, and failure tests.
- Create `apps/webapp/src/lib/approvals/approval-write-boundary-sql.ts`: protected-table SQL mutation extraction built from the existing lexer/evaluator patterns.
- Create `apps/webapp/src/lib/approvals/approval-write-boundary-typescript.ts`: TypeScript provenance and Drizzle/raw-SQL mutation analysis.
- Create `apps/webapp/src/lib/approvals/approval-write-boundary.ts`: production tree scan, exact ownership allowlist, and violation formatting.
- Create `apps/webapp/src/lib/approvals/approval-write-boundary.test.ts`: analyzer fixtures and current-production inventory test.

### Task 1: Implement The Legacy Write Coordinator

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/legacy-write-coordinator.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/legacy-write-coordinator.test.ts`

- [ ] **Step 1: Write failing lifecycle-order tests**

Define the desired factory and execution input in tests:

```ts
const coordinator = createLegacyApprovalWriteCoordinator({
  writeGate,
  compatibilityWriter,
});

const result = await coordinator.execute({
  organizationId: "org-1",
  workflowType: "absence",
  sourceIdentity,
  actor,
  idempotencyKey: "legacy-decision:request-1",
  expectedVersion: 4,
  captureState,
  mutate,
});
```

Assert exact call order:

- `legacy`: `gate`, `mutate`.
- `shadow` and `ready`: `gate`, `capture-before`, `mutate`, `capture-after`, `mirror`.
- `canonical` and `complete`: `gate`, then typed rejection with no capture, mutation, or mirror.

Assert shadow/ready reject a missing capture callback before mutation.

- [ ] **Step 2: Run coordinator tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/domain-adapters/legacy-write-coordinator.test.ts
```

Expected: FAIL because the coordinator module does not exist.

- [ ] **Step 3: Define the coordinator contract and typed error**

Implement these public contracts:

```ts
export type LegacyApprovalWriteBoundaryErrorCode =
  | "canonical_authority"
  | "invalid_source_identity"
  | "observation_required"
  | "observation_scope"
  | "observation_unavailable";

export class LegacyApprovalWriteBoundaryError extends Error {
  constructor(
    readonly code: LegacyApprovalWriteBoundaryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LegacyApprovalWriteBoundaryError";
  }
}

export interface LegacyApprovalWriteCoordinator {
  execute<Result>(input: {
    organizationId: string;
    workflowType: ApprovalWorkflowType;
    sourceIdentity: ApprovalSourceIdentity;
    actor: ApprovalEventActorIdentity;
    idempotencyKey: string;
    expectedVersion: number | null;
    captureState?: () => Promise<VerifiedLegacyApprovalState>;
    mutate: () => Promise<Result>;
  }): Promise<Result>;
}
```

`createLegacyApprovalWriteCoordinator` receives only `ApprovalWriteGate` and `ApprovalCompatibilityWriter`; callbacks already close over the caller's transaction service.

- [ ] **Step 4: Implement fixed rollout behavior**

Validate non-empty organization/source values, non-empty idempotency key, `null` or non-negative integer expected version, and exact source organization/workflow identity before acquiring the gate. After acquisition:

```ts
switch (gate.mode) {
  case "legacy":
    return input.mutate();
  case "shadow":
  case "ready":
    return executeObservedLegacyWrite(input);
  case "canonical":
  case "complete":
    throw new LegacyApprovalWriteBoundaryError(
      "canonical_authority",
      "Legacy approval writes are not authoritative for this rollout mode.",
    );
}
```

`executeObservedLegacyWrite` requires `captureState`, validates before/after state against the exact trusted source identity, calls `mirrorLegacyToCanonical`, and rejects a null mirror result as `observation_unavailable`. Return the mutation result only after mirroring succeeds.

- [ ] **Step 5: Add scope and rollback-propagation tests**

Cover foreign organization, workflow type, source type, and source ID in trusted identity and captured states. Assert capture, mutation, and compatibility exceptions propagate without another callback running afterward. Verify the exact actor, idempotency key, and expected version reach the compatibility writer.

- [ ] **Step 6: Run coordinator and compatibility suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/legacy-write-coordinator.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts \
  src/lib/approvals/workflow/cutover.test.ts
```

Expected: PASS for all lifecycle modes and unchanged compatibility behavior.

### Task 2: Extract Protected SQL Mutations

**Files:**
- Create: `apps/webapp/src/lib/approvals/approval-write-boundary-sql.ts`
- Create: `apps/webapp/src/lib/approvals/approval-write-boundary-typescript.ts`
- Create: `apps/webapp/src/lib/approvals/approval-write-boundary.test.ts`

- [ ] **Step 1: Write failing raw-SQL analyzer tests**

Use in-memory TypeScript fixtures and assert extracted `{ table, operation }` pairs for:

```ts
sql`insert into approval_workflow_event (...) values (...)`;
sql`insert into approval_outbox (...) values (...) on conflict (...) do update set payload = excluded.payload`;
sql`with removed as (delete from approval_request where id = ${id}) select * from removed`;
sql.raw("update public.approval_workflow set version = version + 1");
```

Cover quoted/schema-qualified identifiers, PostgreSQL `ONLY`, comments, dollar-quoted strings, multiple statements, and non-executable comments/string literals. Upserts produce both `insert` and `update` ownership requirements for the target table; writable CTE operations are reported independently.

- [ ] **Step 2: Run SQL fixture tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/approval-write-boundary.test.ts -t "raw SQL"
```

Expected: FAIL because the boundary analyzer does not exist.

- [ ] **Step 3: Implement bounded SQL extraction**

Reuse the lexical and constant-expression approach from `workflow/event-append-only-sql.ts`, generalized to these operations:

```ts
export type ApprovalWriteOperation = "insert" | "update" | "delete";

export interface ApprovalTableMutation {
  operation: ApprovalWriteOperation;
  table: ProtectedApprovalTable;
}
```

Recognize every protected snake-case table from the design. Preserve depth/statement limits and fail closed with a dedicated analysis-limit error rather than ignoring unbounded SQL.

- [ ] **Step 4: Write failing Drizzle provenance tests**

Cover named and renamed table imports, namespace imports, variable aliases, parenthesized/type-wrapped expressions, bracket calls, and same-file generic helpers:

```ts
db.insert(approvalRequest).values(value);
db["update"](schema.approvalWorkflowStage).set(value);
const target = approvalOutbox;
db.delete(target);
updateRows(dbService, approvalChainStageInstance, values, where);
```

Assert shadowed local variables and unrelated table names do not produce violations.

- [ ] **Step 5: Implement TypeScript mutation provenance**

Track protected schema symbols through `@/db`, `@/db/schema`, the relevant schema modules, aliases, namespaces, and local variable writes. Track Drizzle/database receivers and SQL tags through the same supported import/alias forms as the append-only analyzer. Model `insert`, `update`, `delete`, and the known `updateRows` helper table argument. Emit file/line/column/table/operation for every mutation.

- [ ] **Step 6: Run analyzer fixtures and confirm GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/approval-write-boundary.test.ts -t "analyzer"
```

Expected: PASS for Drizzle, raw SQL, generic helper, false-positive, and analysis-limit fixtures.

### Task 3: Enforce Exact Production Ownership

**Files:**
- Create: `apps/webapp/src/lib/approvals/approval-write-boundary.ts`
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary.test.ts`

- [ ] **Step 1: Write the failing ownership tests**

Create temporary production trees proving:

- Exact normalized path/table/operation entries pass.
- A permitted table in the wrong file fails.
- A permitted file using an extra operation fails.
- Tests, specs, Drizzle migration files, generated auth schema, and symlinks are excluded exactly.
- Directory-prefix similarity does not inherit permission.
- Violation output includes path, table, operation, line, and column.

- [ ] **Step 2: Define the canonical ownership allowlist**

Allow only:

```ts
const CANONICAL_WRITE_OWNERS = {
  "src/lib/approvals/workflow/repository.ts": {
    approval_workflow: ["insert", "update"],
    approval_workflow_stage: ["insert", "update"],
    approval_stage_assignment: ["insert", "update"],
    approval_workflow_event: ["insert"],
    approval_workflow_command: ["insert", "update"],
  },
  "src/lib/approvals/workflow/compatibility-writer.ts": {
    approval_workflow_stage: ["update"],
  },
  "src/lib/approvals/projection/writer.ts": {
    approval_requester_projection: ["insert", "update"],
    approval_inbox_projection: ["insert", "update", "delete"],
  },
  "src/lib/approvals/outbox/writer.ts": {
    approval_outbox: ["insert"],
  },
  "scripts/approval-workflow-rollout.ts": {
    approval_workflow_rollout: ["insert", "update"],
  },
} as const;
```

`approval_outbox_delivery` and `approval_workflow_migration_issue` remain deny-all.

- [ ] **Step 3: Define exact temporary legacy exceptions**

Add only the audited current paths and operations:

- `src/lib/approvals/policies/chain-service.ts`: request/chain/stage insert and update.
- `src/lib/approvals/server/absence-approvals.ts`: request insert.
- `src/app/[locale]/(app)/time-tracking/actions/approvals.ts`: request insert.
- `src/lib/approvals/server/shared.ts`: request update.
- `src/lib/teams/jobs/escalation-checker.ts`: request update.
- `src/lib/absences/sick-vacation-override.ts`: request insert and update.
- `src/app/[locale]/(app)/absences/mutations.ts`: request delete.
- `src/lib/time-record/migration/backfill.ts`: request update.
- `src/lib/demo/demo-data.service.ts`: request insert.
- `src/lib/demo/delete-non-admin.ts`: request delete.
- `src/lib/jobs/organization-cleanup.ts`: request delete.

Export the exception map separately with a comment requiring removal when each domain adapter migrates. Do not allow unknown files or operations.

- [ ] **Step 4: Implement production scanning**

Scan `apps/webapp/src` and `apps/webapp/scripts`, normalize paths relative to `apps/webapp`, prefilter protected table symbols/names, skip only exact test/generated/migration categories, and compare every analyzer result to canonical owners plus temporary legacy exceptions. Deduplicate and ASCII-sort violations for deterministic CI output.

- [ ] **Step 5: Run the real inventory and confirm GREEN**

Add a test against the actual webapp roots:

```ts
expect(
  scanApprovalWriteBoundary({
    workspaceRoot: process.cwd(),
    roots: ["src", "scripts"],
  }),
).toEqual([]);
```

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/approval-write-boundary.test.ts
```

Expected: PASS only when every current protected-table mutation is owned or explicitly listed.

### Task 4: Verify The Phase 4.1 Boundary

**Files:**
- Review all files in the file map.

- [ ] **Step 1: Run focused boundary suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/legacy-write-coordinator.test.ts \
  src/lib/approvals/domain-adapters/registry.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts \
  src/lib/approvals/workflow/cutover.test.ts \
  src/lib/approvals/approval-write-boundary.test.ts \
  src/lib/approvals/workflow/event-append-only-guard.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run type and static checks**

Run:

```bash
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/domain-adapters/legacy-write-coordinator.ts \
  src/lib/approvals/domain-adapters/legacy-write-coordinator.test.ts \
  src/lib/approvals/approval-write-boundary-sql.ts \
  src/lib/approvals/approval-write-boundary-typescript.ts \
  src/lib/approvals/approval-write-boundary.ts \
  src/lib/approvals/approval-write-boundary.test.ts
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Perform final security and scope review**

Verify callbacks cannot run before authority validation; shadow/ready cannot mutate without successful observation; captured state is exact-source scoped; the static guard defaults new writers to deny; and every exception is exact-path/table/operation limited.
