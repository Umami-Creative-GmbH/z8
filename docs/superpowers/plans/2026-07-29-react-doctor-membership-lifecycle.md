# React Doctor Membership Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove actionable membership-service await diagnostics, preserve rejected-member audit history, and reject invite-code reuse after rejection.

**Architecture:** Parallelize only independent organization-scoped reads inside existing transactions. Persist rejection identity in independent audit history, then atomically remove the Better Auth membership and database access under the canonical identity lock. Keep secondary-session cleanup and billing post-commit. Resolve invite codes without cross-tenant ambiguity and protect pending-code clears with compare-and-swap.

**Tech Stack:** TypeScript, Effect, Drizzle ORM, PostgreSQL, Vitest

**Delivery constraint:** Leave all edits unstaged and uncommitted for working-tree review.

---

### Task 1: Prove Invite-Code Reads Start Together

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/invite-code.service.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/invite-code.service.ts:253-270`

- [ ] **Step 1: Add a deferred-promise test fixture**

Add this helper near the test file's existing fixtures:

```ts
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}
```

- [ ] **Step 2: Add a failing concurrent-start test**

Extend `ReactivationFakeOptions` with `employeeFindFirst` and `teamFindFirst` async overrides. Invoke those overrides from the existing `reactivationLayer` employee and team `findFirst` mocks. Add this test to the preserved-employee reactivation suite:

```ts
it("starts employee and default-team reads together", async () => {
	const employeeRead = deferred<Record<string, unknown> | null>();
	const teamRead = deferred<{ id: string } | null>();
	const fake = reactivationLayer({
		defaultTeamId: "team-1",
		employeeFindFirst: () => employeeRead.promise,
		teamFindFirst: () => teamRead.promise,
	});

	const result = redeemNoApprovalCode(fake.layer);

	try {
		await vi.waitFor(() => {
			expect(fake.mockDb.query.employee.findFirst).toHaveBeenCalledOnce();
		});
		expect(fake.mockDb.query.team.findFirst).toHaveBeenCalledOnce();
	} finally {
		employeeRead.resolve(null);
		teamRead.resolve({ id: "team-1" });
	}

	await expect(result).resolves.toMatchObject({
		success: true,
		status: "approved",
	});
});
```

The `try/finally` is required so a RED assertion cannot leave unresolved promises behind.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/invite-code.service.test.ts
```

Expected: the new test fails because the team read does not start until the employee promise resolves.

- [ ] **Step 4: Parallelize the independent reads**

Replace the two awaits in `provisionEmployeeForInviteCode` with:

```ts
const [existingEmployee, targetTeamId] = await Promise.all([
	dbClient.query.employee.findFirst({
		where: and(
			eq(employee.userId, userId),
			eq(employee.organizationId, inviteCodeRecord.organizationId),
		),
	}),
	resolveInviteCodeTargetTeamId(
		dbClient,
		inviteCodeRecord.organizationId,
		inviteCodeRecord.defaultTeamId,
	),
]);
```

Keep all employee insert/reactivation logic after this block unchanged.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the Step 3 command.

Expected: all invite-code service tests pass, including organization isolation, invalid-team handling, reactivation, and idempotency.

### Task 2: Prove Pending Approval Reads Start Together

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/pending-member.service.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/pending-member.service.ts:228-281`

- [ ] **Step 1: Add the deferred helper and extend the pending-member fake**

Add the same `deferred<T>()` helper to `pending-member.service.test.ts`. Extend `ApprovalFakeOptions` with `approvalInsertPromise?: Promise<void>` and `employeeReadPromise?: Promise<void>`. Record invocation events before awaiting them:

```ts
events.push("approval-insert-start");
if (options?.approvalInsertPromise) await options.approvalInsertPromise;

events.push("employee-read-start");
if (options?.employeeReadPromise) await options.employeeReadPromise;
```

- [ ] **Step 2: Add the failing concurrent-start test**

```ts
it("starts the approval insert and employee read together after winning the transition", async () => {
	const approvalInsert = deferred<void>();
	const employeeRead = deferred<void>();
	const fake = approvalLayer({
		approvalInsertPromise: approvalInsert.promise,
		employeeReadPromise: employeeRead.promise,
	});

	const result = approveWith(fake.layer);
	try {
		await vi.waitFor(() => {
			expect(fake.events).toContain("approval-insert-start");
		});
		expect(fake.events).toContain("employee-read-start");
	} finally {
		approvalInsert.resolve();
		employeeRead.resolve();
	}
	await expect(result).resolves.toMatchObject({ success: true });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/pending-member.service.test.ts
```

Expected: the employee read has not started while the approval insert is unresolved.

- [ ] **Step 4: Group the independent operations**

After `approvedMember` is confirmed, replace the sequential approval insert and employee read with:

```ts
const [[approval], existingEmployee] = await Promise.all([
	tx
		.insert(memberApproval)
		.values({
			memberId: input.memberId,
			organizationId: input.organizationId,
			status: "approved",
			assignedTeamId: input.assignedTeamId,
			approvedBy: input.approvedBy,
			notes: input.notes,
		})
		.returning(),
	tx.query.employee.findFirst({
		where: and(
			eq(employee.userId, approvedMember.userId),
			eq(employee.organizationId, input.organizationId),
		),
	}),
]);
```

Keep employee provisioning after the `Promise.all` and billing after transaction commit.

This proves concurrent JavaScript initiation only. Drizzle uses one node-postgres transaction client, so PostgreSQL statements remain serialized on that connection; do not claim wire-level parallel execution or add cancellation behavior.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the Step 3 command.

Expected: all pending-member tests pass.

### Task 3: Preserve Rejection History Without Retaining Authorization

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/pending-member.service.test.ts:520-650`
- Modify: `apps/webapp/src/lib/effect/services/pending-member.service.ts:286-382`
- Modify: `apps/webapp/src/lib/effect/services/invite-code.service.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/invite-code.service.ts:324-343,840-841,867-935,1067-1068`

> **Security amendment:** Better Auth authorizes organization access from live `member` existence and ignores Z8's custom status for that decision. The former retained-member Steps 1-9 below are superseded and must not be implemented. They remain only as the rejected design history that motivated the final tests.

The implemented replacement is:

1. Add RED tests proving rejection removes the Better Auth member, retains independent organization-scoped audit identity and notes, revokes database sessions, deactivates the employee only without an approved replacement, and performs no post-commit side effects on rollback.
2. Under the canonical organization/normalized-identity advisory lock, transactionally write durable audit history, delete the guarded pending member, revoke organization-active database sessions, and perform replacement-aware employee cleanup. Reuse shared member-removal primitives and run secondary-session cleanup plus billing only after commit.
3. Resolve rejected reuse from safely parsed durable audit metadata before enterprise enforcement or pending-code clearing. Read usage statistics from one organization-scoped repeatable-read snapshot after member-linked rows cascade.
4. Resolve both direct and pending code text with a bounded two-row query. Zero or multiple tenant matches never select an organization.
5. Lock and revalidate the uniquely resolved invite during redemption, compare-and-clear the exact pending code before lifecycle writes, and guard the usage increment against concurrent `maxUses` overrun.
6. Verify rollback, malformed audit metadata, duplicate audits, cross-tenant ambiguity, stale-code replacement, enterprise-denied rejection reuse, session cleanup, replacement membership, and post-commit billing behavior.

#### Superseded Retained-Member Approach

- [ ] **Step 1: Change the rejection fake to model status transitions and retained rows**

Replace the rejection fixture's delete-only state with retained `members`, `approvals`, and `inviteCodeUsages` arrays, plus `memberUpdates` and `deletedMembers`. Add `transitionWins?: boolean` to `RejectionFakeOptions`. The transaction mock must snapshot and restore every array on failure. Keep a delete mock only to make the old implementation fail RED by simulating the real cascade into approval and usage arrays.

The transition mock must record:

```ts
	memberUpdates.push(values);
	return options.transitionWins === false
		? []
		: [{ id: "member-1", status: "rejected" }];
```

- [ ] **Step 2: Add failing persistence and race tests**

```ts
it("retains the rejected member, approval audit, and invite usage", async () => {
	const fake = rejectionLayer();

	await expect(rejectWith(fake.layer)).resolves.toMatchObject({ success: true });

	expect(fake.memberUpdates).toEqual([{ status: "rejected" }]);
	expect(fake.members).toEqual([
		expect.objectContaining({ id: "member-1", status: "rejected" }),
	]);
	expect(fake.deletedMembers).toEqual([]);
	expect(fake.approvals).toEqual([
		expect.objectContaining({ memberId: "member-1", status: "rejected" }),
	]);
	expect(fake.inviteCodeUsages).toHaveLength(1);
});

it("creates no rejection audit when the pending-to-rejected transition loses", async () => {
	const fake = rejectionLayer({ transitionWins: false });

	await expect(rejectWith(fake.layer)).rejects.toBeDefined();
	expect(fake.approvals).toEqual([]);
	expect(fake.inviteCodeUsages).toHaveLength(1);
	expect(fake.members).toEqual([
		expect.objectContaining({ id: "member-1", status: "pending" }),
	]);
});
```

Update all existing rejection assertions that inspect `deletes` to inspect the guarded member update and retained state instead. Keep duplicate, race, rollback, and tenant-isolation assertions.

- [ ] **Step 3: Run pending-member tests and verify RED**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/pending-member.service.test.ts
```

Expected: retention tests fail because rejection still deletes the member and cascades the fake approval and usage state.

- [ ] **Step 4: Replace deletion with a guarded status transition**

Move the rejection audit insert after this transition:

```ts
const [rejectedMember] = await tx
	.update(member)
	.set({ status: "rejected" })
	.where(
		and(
			eq(member.id, input.memberId),
			eq(member.organizationId, input.organizationId),
			eq(member.status, "pending"),
		),
	)
	.returning({ id: member.id, status: member.status });

if (!rejectedMember || rejectedMember.status !== "rejected") {
	throw new Error("Pending member changed before rejection");
}

const [rejection] = await tx
	.insert(memberApproval)
	.values({
		memberId: input.memberId,
		organizationId: input.organizationId,
		status: "rejected",
		approvedBy: input.rejectedBy,
		notes: input.notes,
	})
	.returning();
```

Delete the member-delete block. Once the GREEN test proves production no longer deletes, remove the fake cascade-delete compatibility branch so the final harness models only supported behavior. Preserve the initial row lock, organization/status checks, user/usage reads, and returned `pendingMember` snapshot.

- [ ] **Step 5: Run pending-member tests and verify GREEN**

Run the Step 3 command.

Expected: approval, rejection, duplicate, race, rollback, and tenant-isolation tests pass with retained history.

- [ ] **Step 6: Add rejected-code reuse and scoped usage-statistics tests**

Add a hoisted `billingMock.sync`, mock `@/lib/billing/seat-sync-trigger`, and clear it with the existing identity mock in `beforeEach`. Use `reactivationLayer` with an existing `{ status: "rejected" }` member and call the existing `InviteCodeService.useCode` path through `Effect.either`. Assert this exact typed failure and no writes, employee/team reads, or billing sync:

```ts
const billingMock = vi.hoisted(() => ({
	sync: vi.fn(async () => undefined),
}));

vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	syncBillingSeatsAfterMemberChange: billingMock.sync,
}));
```

```ts
expect(result).toMatchObject({
	_tag: "Left",
	left: expect.objectContaining({
		_tag: "ValidationError",
		message: "Membership for this invite code was rejected",
		field: "code",
	}),
});
expect(fake.mockDb.insert).not.toHaveBeenCalled();
expect(fake.mockDb.update).not.toHaveBeenCalled();
expect(fake.mockDb.query.employee.findFirst).not.toHaveBeenCalled();
expect(fake.mockDb.query.team.findFirst).not.toHaveBeenCalled();
expect(billingMock.sync).not.toHaveBeenCalled();
```

Add a `usageStatsLayer` whose retained usage points to `member-1` and whose approval query returns the organization rejection only when the Drizzle predicate includes `org-1`. Assert:

```ts
expect(stats).toEqual({
	total: 1,
	pending: 0,
	approved: 0,
	rejected: 1,
});
expect(compiledApprovalQuery.params).toContain("org-1");
```

Keep the existing foreign-organization invite-statistics not-found test.

- [ ] **Step 7: Run invite-code tests and verify RED**

```bash
pnpm --filter webapp test src/lib/effect/services/invite-code.service.test.ts
```

Expected: rejected reuse is incorrectly reported as approved and the approval-history query lacks explicit organization scoping.

- [ ] **Step 8: Add one typed status resolver and scope approval history**

Add this local helper inside `InviteCodeServiceLive`:

```ts
const resolveRedemptionStatus = (
	memberStatus: string | null | undefined,
): Effect.Effect<"pending" | "approved", ValidationError> => {
	if (memberStatus === "rejected") {
		return Effect.fail(
			new ValidationError({
				message: "Membership for this invite code was rejected",
				field: "code",
			}),
		);
	}

	return Effect.succeed(memberStatus === "pending" ? "pending" : "approved");
};
```

Use it in both `useCode` and `processPendingInviteCode` instead of coercing every non-pending status to approved. Scope `memberApproval.findMany` with:

```ts
where: and(
	sql`${memberApproval.memberId} = ANY(${memberIds})`,
	eq(memberApproval.organizationId, organizationId),
),
```

- [ ] **Step 9: Run invite-code tests and verify GREEN**

Run the Step 7 command. Expected: rejected reuse fails without side effects and retained usage is classified with organization-scoped approvals.

- [ ] **Step 10: Add pending-code CAS race tests**

Extend the public `processPendingInviteCode` fixture with persisted pending-code state and transaction rollback snapshots. Add cases where code `A` is read and then replaced by code `B` before clearing. For valid `A`, missing/expired `A`, and enterprise-blocked `A`, assert `B` remains, stale processing returns `null`, and no stale redemption or billing occurs. Add a clear failure inside the redemption transaction and assert no committed member, usage, employee, invite-count, pending-code, or billing effects.

- [ ] **Step 11: Compare-and-clear the expected pending code**

Add an internal helper that sets `user.pendingInviteCode` to `null` only where both `user.id` and `user.pendingInviteCode` equal the values read by the operation, returning whether one row was affected. Invalid/expired/blocked external clears return `null` when the CAS loses. Valid redemption passes the expected code into `redeemInviteCodeInTransaction`; after rejected-member classification, run the CAS on the transaction client before lifecycle writes. Return a stale outcome without writes when the CAS loses. Publish billing only after a committed non-stale redemption.

- [ ] **Step 12: Verify pending-code atomicity**

Run the Step 7 command and the combined membership command from Task 4. Expected: every stale operation retains the replacement code and performs no lifecycle or billing side effects.

### Task 4: Validate Membership Changes

**Files:**
- Verify all files changed in Tasks 1-3

- [ ] **Step 1: Run focused tests**

```bash
pnpm --filter webapp test src/lib/effect/services/invite-code.service.test.ts src/lib/effect/services/pending-member.service.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run webapp typecheck**

```bash
pnpm --filter webapp typecheck
```

Expected: route generation and both TypeScript projects pass.

- [ ] **Step 3: Inspect unstaged changes**

```bash
git diff --check && git status --short
```

Expected: no whitespace errors; membership files and the approved unstaged docs are present. Do not stage or commit.
