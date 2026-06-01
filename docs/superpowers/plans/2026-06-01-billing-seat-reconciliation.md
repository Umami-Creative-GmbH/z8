# Billing Seat Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Stripe subscription seat quantities aligned with approved, non-demo organization members and correct drift through an hourly worker reconciliation job.

**Architecture:** Centralize the billable-seat definition inside `SeatSyncService`, then make all real-time sync paths and the new cron reconciliation job use that same service. The reconciliation job runs only when `BILLING_ENABLED=true`, processes Stripe-backed subscriptions, and reports per-organization errors without stopping the whole batch.

**Tech Stack:** Next.js app code, Drizzle ORM, Effect services, BullMQ cron registry, Vitest, pnpm.

---

## File Structure

- Modify `apps/webapp/src/lib/effect/services/billing/seat-sync.service.ts`: count only approved non-demo members and expose that count through existing methods.
- Modify `apps/webapp/src/lib/effect/services/billing/seat-sync.service.test.ts`: add regression tests for approved, pending, and demo members.
- Create `apps/webapp/src/lib/jobs/billing-seat-reconciliation.ts`: worker processor that syncs Stripe-backed subscriptions when billing is enabled.
- Create `apps/webapp/src/lib/jobs/billing-seat-reconciliation.test.ts`: test enabled, disabled, and per-organization failure behavior.
- Modify `apps/webapp/src/lib/cron/registry.ts`: add result type and register `cron:billing-seat-reconciliation` hourly.
- Modify `apps/webapp/src/lib/cron/registry.test.ts`: assert the cron job is registered with the expected schedule.
- Keep existing hook fixes in `apps/webapp/src/lib/auth.ts`, `apps/webapp/src/lib/billing/seat-sync-trigger.ts`, and `apps/webapp/src/lib/effect/services/invite-code.service.ts` from the current working tree.

---

### Task 1: Centralize Billable Seat Counting

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/billing/seat-sync.service.ts`
- Test: `apps/webapp/src/lib/effect/services/billing/seat-sync.service.test.ts`

- [ ] **Step 1: Write the failing billable count tests**

Add or extend tests in `apps/webapp/src/lib/effect/services/billing/seat-sync.service.test.ts` to cover the billing rule:

```ts
it("counts only approved non-demo members as billable seats", async () => {
	const organizationId = "org-billable-count";
	await createMember({ organizationId, userId: "user-approved", email: "approved@example.com", status: "approved" });
	await createMember({ organizationId, userId: "user-pending", email: "pending@example.com", status: "pending" });
	await createMember({ organizationId, userId: "user-demo", email: "demo-abc@demo.invalid", status: "approved" });

	const count = await Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* SeatSyncService;
			return yield* service.getCurrentSeatCount(organizationId);
		}).pipe(Effect.provide(testLayer)),
	);

	expect(count).toBe(1);
});
```

If the test file uses different helpers, adapt the setup to the existing helper names while preserving these exact rows and expectation.

- [ ] **Step 2: Run the focused red test**

Run: `pnpm vitest run src/lib/effect/services/billing/seat-sync.service.test.ts`

Expected: fails because pending or demo members are still included in the count.

- [ ] **Step 3: Implement the centralized eligibility query**

In `apps/webapp/src/lib/effect/services/billing/seat-sync.service.ts`, update the imports and count logic:

```ts
import { and, count, eq, notLike } from "drizzle-orm";
import { member, user } from "@/db/auth-schema";
```

Add a local helper near the service implementation:

```ts
async function countBillableMembers(organizationId: string): Promise<number> {
	const [result] = await db
		.select({ count: count() })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(
			and(
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
				notLike(user.email, "%@demo.invalid"),
			),
		);

	return result?.count ?? 0;
}
```

Use `countBillableMembers(organizationId)` in both `syncSeatsForOrganization` and `getCurrentSeatCount`.

- [ ] **Step 4: Verify the focused test passes**

Run: `pnpm vitest run src/lib/effect/services/billing/seat-sync.service.test.ts`

Expected: all tests in the file pass.

---

### Task 2: Add Billing Seat Reconciliation Job

**Files:**
- Create: `apps/webapp/src/lib/jobs/billing-seat-reconciliation.ts`
- Test: `apps/webapp/src/lib/jobs/billing-seat-reconciliation.test.ts`

- [ ] **Step 1: Write disabled-env and batch behavior tests**

Create `apps/webapp/src/lib/jobs/billing-seat-reconciliation.test.ts` with tests for these behaviors:

```ts
it("skips reconciliation when billing is disabled", async () => {
	vi.stubEnv("BILLING_ENABLED", "false");
	const { runBillingSeatReconciliation } = await import("./billing-seat-reconciliation");

	const result = await runBillingSeatReconciliation();

	expect(result).toMatchObject({
		success: true,
		billingEnabled: false,
		processed: 0,
		synced: 0,
		skipped: 1,
		errors: [],
	});
});

it("syncs Stripe-backed subscriptions and reports per-organization failures", async () => {
	vi.stubEnv("BILLING_ENABLED", "true");
	vi.doMock("@/db", () => ({
		db: {
			query: {
				subscription: {
					findMany: vi.fn().mockResolvedValue([
						{ organizationId: "org-success" },
						{ organizationId: "org-failing" },
					]),
				},
			},
		},
	}));
	vi.doMock("effect", async () => {
		const actual = await vi.importActual<typeof import("effect")>("effect");
		return {
			...actual,
			Effect: {
				...actual.Effect,
				runPromise: vi
					.fn()
					.mockResolvedValueOnce(3)
					.mockRejectedValueOnce(new Error("stripe unavailable")),
			},
		};
	});

	const { runBillingSeatReconciliation } = await import("./billing-seat-reconciliation");
	const result = await runBillingSeatReconciliation();

	expect(result.billingEnabled).toBe(true);
	expect(result.processed).toBe(2);
	expect(result.synced).toBe(1);
	expect(result.errors).toEqual([
		expect.objectContaining({ organizationId: "org-failing" }),
	]);
});
```

Add `beforeEach(() => vi.resetModules())` and `afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.doUnmock("@/db"); vi.doUnmock("effect"); })` around these tests so environment and module mocks do not leak into other files.

- [ ] **Step 2: Run the red job tests**

Run: `pnpm vitest run src/lib/jobs/billing-seat-reconciliation.test.ts`

Expected: fails because `billing-seat-reconciliation.ts` does not exist.

- [ ] **Step 3: Implement the job processor**

Create `apps/webapp/src/lib/jobs/billing-seat-reconciliation.ts`:

```ts
import { isNotNull } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { db } from "@/db";
import { subscription } from "@/db/schema";
import { env } from "@/env";
import {
	SeatSyncService,
	SeatSyncServiceLive,
	StripeServiceLive,
	SubscriptionServiceLive,
} from "@/lib/effect/services/billing";
import { createLogger } from "@/lib/logger";

const logger = createLogger("BillingSeatReconciliation");

export interface BillingSeatReconciliationResult {
	success: boolean;
	billingEnabled: boolean;
	processed: number;
	synced: number;
	skipped: number;
	errors: Array<{ organizationId: string; error: string }>;
}

export async function runBillingSeatReconciliation(): Promise<BillingSeatReconciliationResult> {
	if (env.BILLING_ENABLED !== "true") {
		return {
			success: true,
			billingEnabled: false,
			processed: 0,
			synced: 0,
			skipped: 1,
			errors: [],
		};
	}

	const subscriptions = await db.query.subscription.findMany({
		where: isNotNull(subscription.stripeSubscriptionId),
		columns: { organizationId: true },
	});

	const layers = SeatSyncServiceLive.pipe(
		Layer.provide(StripeServiceLive),
		Layer.provide(SubscriptionServiceLive),
	);

	let synced = 0;
	const errors: BillingSeatReconciliationResult["errors"] = [];

	for (const item of subscriptions) {
		try {
			await Effect.runPromise(
				Effect.gen(function* () {
					const seatSyncService = yield* SeatSyncService;
					return yield* seatSyncService.syncSeatsForOrganization(item.organizationId);
				}).pipe(Effect.provide(layers)),
			);
			synced += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push({ organizationId: item.organizationId, error: message });
			logger.error({ error, organizationId: item.organizationId }, "Billing seat reconciliation failed");
		}
	}

	return {
		success: errors.length === 0,
		billingEnabled: true,
		processed: subscriptions.length,
		synced,
		skipped: 0,
		errors,
	};
}
```

- [ ] **Step 4: Verify job tests pass**

Run: `pnpm vitest run src/lib/jobs/billing-seat-reconciliation.test.ts`

Expected: all tests in the file pass.

---

### Task 3: Register the Cron Job

**Files:**
- Modify: `apps/webapp/src/lib/cron/registry.ts`
- Test: `apps/webapp/src/lib/cron/registry.test.ts`

- [ ] **Step 1: Write the failing registry test**

Add a test to `apps/webapp/src/lib/cron/registry.test.ts`:

```ts
it("registers hourly billing seat reconciliation", () => {
	const job = getCronJobDefinition("cron:billing-seat-reconciliation");

	expect(job.schedule).toBe("0 * * * *");
	expect(job.description).toContain("billing seat");
});
```

- [ ] **Step 2: Run the red registry test**

Run: `pnpm vitest run src/lib/cron/registry.test.ts`

Expected: fails because `cron:billing-seat-reconciliation` is not a valid cron job name.

- [ ] **Step 3: Register the cron job**

In `apps/webapp/src/lib/cron/registry.ts`, add this type-only import near the existing imports:

```ts
import type { BillingSeatReconciliationResult } from "@/lib/jobs/billing-seat-reconciliation";
```

Add this entry to `CRON_JOBS`:

```ts
"cron:billing-seat-reconciliation": {
	schedule: "0 * * * *",
	description: "Reconcile billing seat counts for Stripe subscriptions",
	processor: async (): Promise<BillingSeatReconciliationResult> => {
		const { runBillingSeatReconciliation } = await import(
			"@/lib/jobs/billing-seat-reconciliation"
		);
		return runBillingSeatReconciliation();
	},
	defaultJobOptions: { attempts: 2, priority: 8 },
},
```

- [ ] **Step 4: Verify registry tests pass**

Run: `pnpm vitest run src/lib/cron/registry.test.ts`

Expected: all registry tests pass.

---

### Task 4: Verify Existing Seat Sync Hook Fixes

**Files:**
- Modify if needed: `apps/webapp/src/lib/auth.ts`
- Modify if needed: `apps/webapp/src/lib/billing/seat-sync-trigger.ts`
- Modify if needed: `apps/webapp/src/lib/effect/services/invite-code.service.ts`
- Test: `apps/webapp/src/lib/auth.test.ts`
- Test: `apps/webapp/src/lib/effect/services/invite-code.service.test.ts`

- [ ] **Step 1: Run existing red/green hook tests**

Run: `pnpm vitest run src/lib/auth.test.ts src/lib/effect/services/invite-code.service.test.ts`

Expected: tests pass after the current working-tree hook changes. If they fail, inspect the assertion and make the smallest source change that satisfies the existing tests.

- [ ] **Step 2: Confirm approved-only invite-code sync behavior**

Ensure `apps/webapp/src/lib/effect/services/invite-code.service.ts` calls `syncBillingSeatsAfterMemberChange` only inside `if (memberStatus === "approved")` blocks for both immediate and pending invite-code redemption paths.

- [ ] **Step 3: Re-run hook tests**

Run: `pnpm vitest run src/lib/auth.test.ts src/lib/effect/services/invite-code.service.test.ts`

Expected: all tests pass.

---

### Task 5: Final Verification

**Files:**
- No new files unless a previous task fails and needs a targeted fix.

- [ ] **Step 1: Run focused billing and cron tests**

Run: `pnpm vitest run src/lib/effect/services/billing/seat-sync.service.test.ts src/lib/jobs/billing-seat-reconciliation.test.ts src/lib/cron/registry.test.ts src/lib/auth.test.ts src/lib/effect/services/invite-code.service.test.ts`

Expected: all listed tests pass.

- [ ] **Step 2: Run existing billing UI and Stripe tests**

Run: `pnpm vitest run src/lib/effect/services/billing/stripe.service.test.ts src/components/billing/billing-page-client.test.tsx`

Expected: all listed tests pass.

- [ ] **Step 3: Run production build**

Run: `CI=true pnpm build`

Expected: build succeeds. If it fails with truncated output, rerun and inspect the captured full output to identify the first real error.

- [ ] **Step 4: Report without committing**

Do not commit unless the user explicitly asks. Summarize changed files, verification commands, and any remaining risks.

---

## Self-Review

- Spec coverage: the plan covers centralized billable-seat counting, pending/demo exclusion, hourly reconciliation, `BILLING_ENABLED=true` gating, per-organization error handling, cron registration, and verification.
- Placeholder scan: no implementation step is left as an unspecified TODO; test examples include concrete rows, mocks, commands, and expected outcomes.
- Type consistency: `BillingSeatReconciliationResult`, `runBillingSeatReconciliation`, `cron:billing-seat-reconciliation`, and `syncSeatsForOrganization` are used consistently across tasks.
