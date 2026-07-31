# Approval Stage Activation Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve and materialize canonical approval reviewers from current organization directory data inside the stage-activation transaction.

**Architecture:** The transition engine supplies its transaction-bound `ApprovalDbService` to the activation port. A database-backed routing adapter validates persisted snapshots, queries the scoped directory, delegates selection to the Phase 3.2 pure resolver, and maps the result to `ResolvedStage`. The state machine records the resolver's supported activation mode on a waiting stage before creating assignments or auto-approving it.

**Tech Stack:** TypeScript, Drizzle SQL, Vitest, existing approval workflow ports, state machine, and routing modules.

**Constraints:** Work only in `/home/kai/projekte/z8/.worktrees/approval-workflow-rewrite`. Do not commit, create migrations, alter legacy behavior, add a source adapter, or write assignments from the resolver. Every directory query is organization-scoped; malformed snapshots must fail closed.

---

## File Map

- Create `apps/webapp/src/lib/approvals/routing/stage-activation-resolver.ts`: transaction-backed directory reader, persisted snapshot decoder, pure resolver adapter, and `ResolvedStage` mapping.
- Create `apps/webapp/src/lib/approvals/routing/stage-activation-resolver.test.ts`: adapter validation, scope, directory-query, and mapping tests using a transaction DB double.
- Modify `apps/webapp/src/lib/approvals/workflow/ports.ts`: include `dbService` in `StageActivationInput`.
- Modify `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`: pass the transaction-bound service into the activation resolver.
- Modify `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`: assert the activation resolver receives that same transaction-bound service.
- Modify `apps/webapp/src/lib/approvals/workflow/state-machine.ts`: accept either supported resolver mode for a waiting stage and persist it before activation materialization.
- Modify `apps/webapp/src/lib/approvals/workflow/state-machine.test.ts`: lock down runtime mode replacement and invalid-mode rejection.

### Task 1: Permit Runtime Activation Mode Resolution

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.test.ts`

- [x] **Step 1: Write the failing state-machine regression**

Add a test using a waiting stage whose stored `activationMode` is `"human"`, then resolve it as requester auto-approval:

```ts
it("replaces a waiting stage's provisional human mode with requester auto approval", () => {
  const plan = planStageActivation(
    waitingWorkflow({ firstMode: "human" }),
    resolvedStage({
      activationMode: "requester_auto_approve",
      assignments: [],
    }),
    now,
  );

  expect(plan.plannedSnapshot.stages[0]).toMatchObject({
    activationMode: "requester_auto_approve",
    status: "approved",
    decisionReason: "requester_auto_approved",
  });
  expect(plan.events.map((event) => event.eventType)).toContain("stage.auto_approved");
});
```

Keep the existing invalid-mode test and add an assertion that a waiting stage cannot activate with an unsupported string.

- [x] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/state-machine.test.ts -t "provisional human mode"
```

Expected: FAIL with `INVALID_ACTIVATION` because `validateResolvedStage` currently requires the resolver mode to equal the stored stage mode.

- [x] **Step 3: Persist the validated resolver mode**

In `validateResolvedStage`, remove only the equality check between `resolved.activationMode` and `stage.activationMode`; retain workflow/stage identity checks, supported-mode validation, duplicate approver rejection, and assignment-count validation. In `planStageActivation`, after cloning and locating `resultingStage`, set the mode before branching:

```ts
resultingStage.activationMode = resolvedStage.activationMode;
resultingStage.activatedAt = now;
```

The existing `currentStage(snapshot).status === "waiting"` guard remains the sole condition under which mode replacement is possible.

- [x] **Step 4: Run the state-machine suite and confirm GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/state-machine.test.ts
```

Expected: PASS, including human assignment activation, requester auto-approval activation, invalid mode rejection, and terminal/non-waiting stage guards.

### Task 2: Add The Transaction-Bound Activation Port Contract

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/ports.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`

- [x] **Step 1: Write the failing transaction-service propagation test**

Extend the transition-engine fixture to retain the activation input and assert its service is the repository transaction service:

```ts
expect(activationInputs[0]).toMatchObject({
  organizationId: "org-1",
  workflow: expect.objectContaining({ id: engineIds.workflow }),
  stage: expect.objectContaining({ id: engineIds.nextStage }),
  dbService,
});
```

Use the existing fixture's `dbService` reference rather than constructing another object.

- [x] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts -t "activation resolver"
```

Expected: FAIL because `StageActivationInput` and the engine call do not yet carry `dbService`.

- [x] **Step 3: Extend the port and pass the transaction service**

Add the service to the port and engine call without changing repository injection:

```ts
export interface StageActivationInput {
  organizationId: string;
  dbService: ApprovalDbService;
  workflow: ApprovalWorkflowSnapshot;
  stage: ApprovalStageSnapshot;
  actor: ApprovalEventActorIdentity;
  routingContext: JsonObject;
}
```

```ts
const resolved = await context.activationResolver.resolve({
  organizationId: request.organizationId,
  dbService: context.dbService,
  workflow: currentSnapshot,
  stage,
  actor: activationActor,
  routingContext,
});
```

Do not add a root database client or alter `createApprovalWorkflowRepository` ownership; `context.dbService` is already created from its transaction.

- [x] **Step 4: Run the transition-engine suite and confirm GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts
```

Expected: PASS with the resolver receiving the exact transaction-bound service and no existing activation ordering regression.

### Task 3: Implement The Database Activation Resolver

**Files:**
- Create: `apps/webapp/src/lib/approvals/routing/stage-activation-resolver.ts`
- Create: `apps/webapp/src/lib/approvals/routing/stage-activation-resolver.test.ts`

- [x] **Step 1: Write failing adapter tests**

Create a transaction DB double whose `execute` method returns `{ rows }` for each of the four directory queries. Cover:

```ts
it("loads the scoped directory and maps human reviewers to parallel assignments", async () => {
  const resolver = createDatabaseStageActivationResolver();
  await expect(resolver.resolve(activationInput())).resolves.toEqual({
    organizationId: "org-1",
    workflowId: workflow.id,
    stageId: stage.id,
    activationMode: "human",
    assignments: [
      { approverEmployeeId: "00000000-0000-4000-8000-000000000011", metadata: {} },
      { approverEmployeeId: "00000000-0000-4000-8000-000000000012", metadata: {} },
    ],
  });
});

it("maps requester auto approval to no assignments", async () => {
  await expect(resolver.resolve(activationInput({ requesterIsAdmin: true }))).resolves.toMatchObject({
    activationMode: "requester_auto_approve",
    assignments: [],
  });
});

it("rejects a routing context whose trusted identity does not match the workflow", async () => {
  await expect(resolver.resolve(activationInput({ routingContext: { ...context, organizationId: "org-2" } })))
    .rejects.toMatchObject({ code: "invalid_stage_resolver" });
});
```

Add tests that assert all four generated SQL statements contain the activation organization parameter, malformed routing/stage JSON rejects with `invalid_stage_resolver`, and inactive or foreign directory records do not resolve human reviewers.

- [x] **Step 2: Run the adapter suite and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/routing/stage-activation-resolver.test.ts
```

Expected: FAIL because `createDatabaseStageActivationResolver` does not exist.

- [x] **Step 3: Implement strict snapshot decoding and scoped directory loading**

Export `createDatabaseStageActivationResolver(): StageActivationResolver`. Keep all helpers private in `stage-activation-resolver.ts`.

Decode `routingContext` into `ApprovalRoutingContext` by requiring these values: non-empty strings for `organizationId`, `requesterEmployeeId`, `source.type`, and `source.id`; string arrays for `teamIds` and `employeeGroupIds`; `null | string` for `locationId` and `absenceCategoryId`; `null | finite number` for `travelExpenseAmount`; and `null | "none" | "warning" | "violation"` for `overtimeRisk`. Require its organization ID, workflow type, source type, and source ID to equal `input.workflow`'s trusted identity.

Decode `stage.resolverSnapshot` as an object with non-empty string `approverType` and `fallbackBehavior`. Accept a missing `approverEmployeeId`; reject a present non-string value with `ApprovalStageActivationError("invalid_stage_resolver", ...)`.

Execute these parameterized reads through `input.dbService.db.execute(sql`...`)` and extract only `result.rows` records:

```sql
select id, organization_id as "organizationId", is_active as "isActive", role
from employee
where organization_id = ${organizationId}

select managers.employee_id as "employeeId", managers.manager_id as "managerId", managers.is_primary as "isPrimary"
from employee_managers managers
join employee subject on subject.id = managers.employee_id
where subject.organization_id = ${organizationId}

select employee_id as "employeeId", team_id as "teamId"
from team_membership
where organization_id = ${organizationId}

select id, organization_id as "organizationId", primary_manager_id as "primaryManagerId"
from team
where organization_id = ${organizationId}
```

Reject malformed row values with `ApprovalStageActivationError("invalid_stage_resolver", ...)`; do not silently drop malformed rows. Pass the decoded directory to `resolveApprovalStageReviewers`.

- [x] **Step 4: Map the pure disposition to the workflow port**

Use trusted IDs only:

```ts
const resolution = resolveApprovalStageReviewers({ context, stage, directory });
return resolution.activationMode === "human"
  ? {
      organizationId: input.organizationId,
      workflowId: input.workflow.id,
      stageId: input.stage.id,
      activationMode: "human",
      assignments: resolution.approverEmployeeIds.map((approverEmployeeId) => ({
        approverEmployeeId,
        metadata: {},
      })),
    }
  : {
      organizationId: input.organizationId,
      workflowId: input.workflow.id,
      stageId: input.stage.id,
      activationMode: "requester_auto_approve",
      assignments: [],
    };
```

The adapter must not insert assignments, events, or workflow rows.

- [x] **Step 5: Run the adapter suite and confirm GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/routing/stage-activation-resolver.test.ts
```

Expected: PASS for scoped directory reads, strict snapshot validation, human mapping, requester auto-approval, and typed fail-closed errors.

### Task 4: Verify The Activation Boundary

**Files:**
- Review all files in the file map.

- [x] **Step 1: Run focused regression suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/routing/approver-resolver.test.ts \
  src/lib/approvals/routing/stage-activation-resolver.test.ts \
  src/lib/approvals/workflow/state-machine.test.ts \
  src/lib/approvals/workflow/transition-engine.test.ts \
  src/lib/approvals/workflow/ports.test.ts
```

Expected: all tests pass.

- [x] **Step 2: Run type and static checks**

Run:

```bash
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/routing/stage-activation-resolver.ts \
  src/lib/approvals/routing/stage-activation-resolver.test.ts \
  src/lib/approvals/workflow/ports.ts \
  src/lib/approvals/workflow/transition-engine.ts \
  src/lib/approvals/workflow/transition-engine.test.ts \
  src/lib/approvals/workflow/state-machine.ts \
  src/lib/approvals/workflow/state-machine.test.ts
git diff --check
```

Expected: every command exits 0.

- [x] **Step 3: Perform security and scope review**

Verify all directory SQL is parameterized and organization-scoped; every result ID comes from trusted workflow/stage input or a validated scoped directory row; malformed JSON and rows fail closed; the resolver writes no persistence; and only the state machine changes the waiting stage's activation mode.
