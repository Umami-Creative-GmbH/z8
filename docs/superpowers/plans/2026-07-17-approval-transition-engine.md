# Approval Transition Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one organization-scoped transaction engine for canonical approval decisions, idempotency, CAS persistence, source finalization, projection/outbox writes, and activation follow-up.

**Architecture:** The engine is an injected-port application service over the existing transaction repository. Trusted actor resolution and authorization are explicit dependencies; the engine owns command fingerprinting and write order, while the repository remains the transaction, receipt, CAS, identity-allocation, and persistence authority.

**Tech Stack:** TypeScript, Temporal `Instant`, Drizzle transaction repository, Vitest, PostgreSQL 16 disposable runner.

**Execution constraint:** Do not commit. This approval workflow branch remains intentionally uncommitted. Do not add HTTP endpoints, source adapter implementations, migrations, generated auth changes, or domain cutover work.

---

## File Map

- Modify `apps/webapp/src/lib/approvals/workflow/ports.ts`: engine command, trusted principal, actor resolver, authorization, payload builder, and clock contracts.
- Create `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`: transaction orchestration and canonical command fingerprinting.
- Create `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`: deterministic unit tests with repository/writer/adapter doubles.
- Create `apps/webapp/src/lib/approvals/workflow/transition-engine.integration.test.ts`: real PostgreSQL concurrent command and rollback contracts, gated by the existing disposable runner environment.
- Modify `apps/webapp/src/lib/approvals/workflow/repository.integration.test.ts`: seed reusable canonical workflow/source/projection/outbox fixtures only when required by engine integration tests.
- Modify `apps/webapp/scripts/run-approval-workflow-repository-integration.sh`: run both gated repository and transition-engine integration files in the same label-owned migrated database.
- Modify `.github/workflows/tests.yml`: run both gated integration files after migration.

### Task 1: Define Trusted Engine Contracts And Command Fingerprinting

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/ports.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`

- [ ] **Step 1: Write failing contract tests**

Create the test file with these assertions before exporting production types:

```ts
it("fingerprints every semantic command field", () => {
	expect(
		fingerprintApprovalWorkflowCommand({ kind: "approve", reason: null }),
	).not.toBe(
		fingerprintApprovalWorkflowCommand({ kind: "reject", reason: "policy" }),
	);
});

it("does not accept caller supplied command actor identities", () => {
	expectTypeOf<ApprovalWorkflowCommandRequest>().not.toHaveProperty("employeeId");
	expectTypeOf<ApprovalWorkflowCommandRequest>().not.toHaveProperty("userId");
});
```

Use a stable command fixture for every state-machine command kind, including stage/assignment IDs for reassign and escalate.

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts
```

Expected: FAIL because `transition-engine.ts` and its contracts do not exist.

- [ ] **Step 3: Add the minimum port surface**

In `ports.ts`, add these exact contracts:

```ts
export type ApprovalWorkflowPrincipal =
	| { kind: "employee"; userId: string }
	| { kind: "system"; systemId: "approval-expiry" | "approval-activation" };

export interface ApprovalWorkflowCommandRequest {
	organizationId: string;
	workflowId: string;
	expectedVersion: number;
	idempotencyKey: string;
	principal: ApprovalWorkflowPrincipal;
	command: ApprovalWorkflowCommand;
}

export interface ApprovalCommandActorResolver {
	resolve(input: {
		organizationId: string;
		principal: ApprovalWorkflowPrincipal;
	}): Promise<ApprovalCommandActor>;
}

export interface ApprovalWorkflowAuthorization {
	authorize(input: {
		organizationId: string;
		workflow: ApprovalWorkflowSnapshot;
		actor: ApprovalCommandActor;
		command: ApprovalWorkflowCommand;
	}): Promise<"active_assignment" | "manage_approval" | "system">;
}
```

Also add an `ApprovalTransitionResultBuilder` that receives the materialized plan and optional terminal finalization result, and returns an `ApprovalCommandResult`. Add `ApprovalEngineClock` with `nowInstant(): Instant`.

- [ ] **Step 4: Implement canonical fingerprinting**

In `transition-engine.ts`, export:

```ts
export function fingerprintApprovalWorkflowCommand(
	command: ApprovalWorkflowCommand,
): string {
	return JSON.stringify(canonicalizeCommand(command));
}
```

`canonicalizeCommand` must explicitly switch on every command kind and return only semantic fields in fixed key order. It must reject unexpected keys and non-canonical UUIDs by throwing `ApprovalTransitionEngineError` with code `malformed_command`.

- [ ] **Step 5: Run GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts
```

Expected: contract/fingerprint tests pass.

### Task 2: Implement Receipt, Authorization, Planning, And CAS Orchestration

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`

- [ ] **Step 1: Write failing receipt and authorization tests**

Add tests that use an in-memory transaction context recorder:

```ts
it("returns a completed receipt before loading or authorizing", async () => {
	const engine = engineFixture({ claim: { kind: "completed", result } });
	await expect(engine.execute(request)).resolves.toEqual(result);
	expect(engine.calls).toEqual(["resolveActor", "acquireGate", "claim"]);
});

it("rejects a fingerprint mismatch without loading the workflow", async () => {
	const engine = engineFixture({ claim: { kind: "fingerprint_mismatch" } });
	await expect(engine.execute(request)).rejects.toMatchObject({
		code: "idempotency_mismatch",
	});
});

it("permits only active assignment or manage Approval override", async () => {
	await expect(engineFixture({ authorization: "active_assignment" }).execute(request))
		.resolves.toEqual(expect.anything());
	await expect(engineFixture({ authorizationError: "forbidden" }).execute(request))
		.rejects.toMatchObject({ code: "forbidden" });
});

it("allows expiry only for the approval-expiry system principal", async () => {
	await expect(engine.execute({ ...request, command: { kind: "expire", reason: "expired" } }))
		.rejects.toMatchObject({ code: "forbidden" });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts -t "receipt|assignment|expiry"
```

Expected: FAIL because `ApprovalTransitionEngine.execute` does not exist.

- [ ] **Step 3: Implement the transaction prefix**

Create:

```ts
export interface ApprovalTransitionEngine {
	execute(request: ApprovalWorkflowCommandRequest): Promise<ApprovalCommandResult>;
}

export function createApprovalTransitionEngine(
	dependencies: ApprovalTransitionEngineDependencies,
): ApprovalTransitionEngine;
```

Inside `execute`, call `repository.withTransaction` and enforce this prefix in order:

```ts
const actor = await dependencies.actorResolver.resolve({
	organizationId: request.organizationId,
	principal: request.principal,
});
const gate = await context.writeGate.acquire({
	organizationId: request.organizationId,
	workflowType: request.workflowType,
});
const receipt = receiptFor(request, actor);
const claim = await context.repository.claimCommand(receipt);
```

`workflowType` must be obtained from a scoped snapshot before gate acquisition when it is not supplied by the trusted caller. If the current gate API needs workflow type first, load the scoped snapshot before the gate and revalidate the snapshot organization after the gate. Never use an untrusted workflow type.

Return completed receipts, reject mismatch with a typed engine error, and continue only for `reserved`.

- [ ] **Step 4: Add plan/CAS RED tests**

```ts
it("does not finalize or write children when root CAS conflicts", async () => {
	const engine = engineFixture({ cas: { kind: "conflict", version: 4 } });
	await expect(engine.execute(request)).rejects.toMatchObject({ code: "version_conflict" });
	expect(engine.calls).not.toContain("finalizeTerminal");
	expect(engine.calls).not.toContain("applyMaterializedTransition");
});

it("orders allocation, CAS, and materialization", async () => {
	await engine.execute(request);
	expect(engine.calls).toContainSequence([
		"plan", "allocate", "materialize", "tryAdvanceVersion", "applyMaterializedTransition",
	]);
});
```

- [ ] **Step 5: Implement planning and canonical persistence**

Use the state machine and existing repository in this order:

```ts
const plan = planWorkflowTransition(snapshot, request.command, transitionPolicy, clock.nowInstant());
const resolutions = await context.repository.allocateTransitionIdentities({
	organizationId: request.organizationId,
	workflowId: request.workflowId,
	identityAllocations: plan.identityAllocations,
});
const materialized = materializeApprovalTransitionPlan(plan, resolutions, { actor, receipt });
const cas = await context.repository.tryAdvanceVersion({
	organizationId: request.organizationId,
	workflowId: request.workflowId,
	expectedVersion: request.expectedVersion,
});
if (cas.kind === "conflict") throw versionConflict(cas.version);
await context.repository.applyMaterializedTransition(materialized);
```

Require `plan.expectedVersion === request.expectedVersion`; otherwise throw `version_conflict` before allocation. For `cancel_approved`, request an adapter-minted authorization token before planning and include it in transition policy. Do not catch transaction errors: failed writes must roll back the receipt and CAS.

- [ ] **Step 6: Run GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts
```

Expected: receipt, authorization, CAS, and ordering tests pass.

### Task 3: Add Terminal Finalization, Projection, Compatibility, And Outbox Writes

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`

- [ ] **Step 1: Write failing terminal ordering and rollback tests**

```ts
it("runs terminal preflight before CAS and finalizes exactly once after materialization", async () => {
	await engine.execute(terminalApproveRequest);
	expect(engine.calls).toContainSequence([
		"preflightCommand", "preflightTerminal", "tryAdvanceVersion",
		"applyMaterializedTransition", "finalizeTerminal",
	]);
	expect(engine.calls.filter((call) => call === "finalizeTerminal")).toHaveLength(1);
});

it("rolls back the receipt and canonical CAS when projection persistence fails", async () => {
	const engine = engineFixture({ projectionError: new Error("projection failure") });
	await expect(engine.execute(request)).rejects.toThrow("projection failure");
	expect(engine.transactionCommitted).toBe(false);
});

it("does not invoke post-commit handlers", async () => {
	await engine.execute(request);
	expect(engine.postCommitHandler).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts -t "terminal|projection|post-commit"
```

Expected: FAIL because finalization/result-building writes are absent.

- [ ] **Step 3: Implement terminal and durable result writes**

For `materialized.nextAction.kind === "finalize_terminal"`:

1. Call adapter terminal preflight before CAS.
2. After `applyMaterializedTransition`, call `adapter.finalizeTerminal` exactly once.
3. Pass its result and the materialized plan to `resultBuilder.build`.
4. Call canonical-to-legacy compatibility writer when the gate behavior requires legacy writes.
5. Write `result.projection`, then write every `result.outbox` in order using `context.outboxWriter`.
6. Call `completeCommand({ ...receipt, result })` last.

For non-terminal plans, build the result without source finalization. Validate every result workflow/event/projection/outbox organization and workflow matches the request before writing; reject mismatch with `result_scope`.

- [ ] **Step 4: Run GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts
```

Expected: terminal ordering, projection/outbox, compatibility, receipt completion, and rollback tests pass.

### Task 4: Implement Activation Draining And Security Regression Tests

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`

- [ ] **Step 1: Write failing activation and authorization regressions**

```ts
it("drains needs_activation using the resolved stage and system actor", async () => {
	const result = await engine.execute(approveRequest);
	expect(engine.calls).toContainSequence([
		"plan", "resolveActivation", "planActivation", "tryAdvanceVersion",
	]);
	expect(result.snapshot.currentStageOrder).toBe(2);
});

it("rejects cross-organization manager override before receipt completion", async () => {
	const engine = engineFixture({ authorizationError: "forbidden" });
	await expect(engine.execute(crossOrganizationRequest)).rejects.toMatchObject({ code: "forbidden" });
	expect(engine.calls).not.toContain("completeCommand");
});

it("rejects a forged approved-cancellation authorization", async () => {
	await expect(engine.execute(forgedApprovedCancellationRequest)).rejects.toMatchObject({
		code: "forbidden",
	});
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts -t "activation|cross-organization|forged"
```

Expected: FAIL because activation draining and engine authorization enforcement are incomplete.

- [ ] **Step 3: Implement bounded activation loop**

After every materialized transition, while `nextAction.kind === "needs_activation"`:

```ts
const stage = currentSnapshot.stages.find((item) => item.id === nextAction.stageId);
if (!stage) throw engineInvariant("activation_stage_missing");
const resolved = await context.activationResolver.resolve({
	organizationId: currentSnapshot.organizationId,
	workflow: currentSnapshot,
	stage,
	actor: activationActor,
	routingContext: currentSnapshot.contextSnapshot,
});
const activationPlan = planStageActivation(currentSnapshot, resolved, clock.nowInstant());
```

Allocate/materialize/CAS/persist each activation plan using its current version, then continue until no activation is required. Cap transitions at `currentSnapshot.stages.length + 1`; throw `activation_cycle` if exceeded. The same transaction receipt completes only after the final result.

- [ ] **Step 4: Run GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/transition-engine.test.ts
```

Expected: activation and authorization tests pass.

### Task 5: Add Real PostgreSQL Engine Concurrency And Rollback Tests

**Files:**
- Create: `apps/webapp/src/lib/approvals/workflow/transition-engine.integration.test.ts`
- Modify: `apps/webapp/scripts/run-approval-workflow-repository-integration.sh`
- Modify: `.github/workflows/tests.yml`

- [ ] **Step 1: Write gated failing PostgreSQL scenarios**

Reuse the sentinel/database guard and seeded organization/user/member/employee workflow fixture from `repository.integration.test.ts`. Add tests for:

```ts
it("allows exactly one concurrent decision at the same expected version", async () => {
	const [first, second] = await Promise.allSettled([
		engine.execute(approveRequest),
		engine.execute(rejectRequest),
	]);
	expect([first, second].filter((result) => result.status === "fulfilled")).toHaveLength(1);
	expect(await loadWorkflow()).toMatchObject({ version: 2 });
});

it("leaves canonical, projection, outbox, source, and receipt rows unchanged on finalizer failure", async () => {
	await expect(engine.execute(terminalRequest)).rejects.toThrow("finalizer failure");
	expect(await snapshotPersistedRows()).toEqual(before);
});
```

Add cancellation-versus-approval with an authorized manager and assert exactly one terminal status/event. Use a test adapter and result builder that make all writes observable through real canonical, projection, outbox, and source fixture rows.

- [ ] **Step 2: Run RED under the disposable runner**

Run:

```bash
pnpm --filter webapp test:approval-workflow-repository:integration
```

Expected: engine integration file does not exist and the runner does not include it.

- [ ] **Step 3: Extend the runner and CI command**

Change the runner command to execute both files:

```bash
pnpm --dir "$app_directory" exec vitest run \
	src/lib/approvals/workflow/repository.integration.test.ts \
	src/lib/approvals/workflow/transition-engine.integration.test.ts
```

Mirror the same two explicit paths in the CI integration step. Keep the existing sentinel and label cleanup unchanged.

- [ ] **Step 4: Implement integration fixtures and run GREEN**

Use the production repository, real projection/outbox writers, transaction context, and a test-only adapter registry/result builder. The test adapter may update only a dedicated migrated source fixture row through parameterized SQL. Assert exact persisted row snapshots before/after failures and unique terminal workflow/event outcomes after concurrent commands.

Run:

```bash
pnpm --filter webapp test:approval-workflow-repository:integration
```

Expected: migration succeeds, repository and engine integration files pass, and the label-owned container is removed.

### Task 6: Verify And Review Task 2.3

**Files:**
- Review all files in this plan.

- [ ] **Step 1: Run engine and workflow tests**

```bash
pnpm --filter webapp exec vitest run \
	src/lib/approvals/workflow/transition-engine.test.ts \
	src/lib/approvals/workflow/transition-engine.integration.test.ts \
	src/lib/approvals/workflow/repository.test.ts
```

Expected: unit tests pass; integration is skipped without the runner environment.

- [ ] **Step 2: Run disposable PostgreSQL verification**

```bash
pnpm --filter webapp test:approval-workflow-repository:integration
```

Expected: full migration and both integration files pass; label ownership is verified and no owned container remains.

- [ ] **Step 3: Run type and static checks**

```bash
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check --max-diagnostics=200 \
	src/lib/approvals/workflow/transition-engine.ts \
	src/lib/approvals/workflow/transition-engine.test.ts \
	src/lib/approvals/workflow/transition-engine.integration.test.ts \
	src/lib/approvals/workflow/ports.ts
```

Expected: all commands exit 0.

- [ ] **Step 4: Perform security/spec/quality reviews**

Verify before completion:

- trusted actor resolver is called before receipt claim and caller cannot supply employee/user identity;
- every load/write uses request organization and workflow identity;
- cross-organization overrides, forged approved-cancellation tokens, and non-system expiry are rejected;
- all SQL is parameterized through Drizzle/SQL parameters;
- finalizer never runs on CAS conflict and runs once on terminal success;
- no post-commit handler is invoked;
- receipt completion is last and every failure rolls back the transaction.
