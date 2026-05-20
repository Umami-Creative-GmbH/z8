# Billing Trial Suspension Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce billing-enabled 14-day org trials, Stripe Checkout subscription recovery, and hard suspension for orgs without valid billing access.

**Architecture:** Keep billing state organization-scoped in the existing `subscription` table and make `BillingEnforcementService` the central access decision point. Add lazy local trials, page-level blocking in the app layout, reusable mutation guards for org-scoped writes, Stripe Checkout remaining-trial behavior, and localized trial/suspension UI.

**Tech Stack:** Next.js App Router, React Server Components, Tolgee `t()`, Drizzle ORM/Postgres, Effect services, Better Auth, CASL, Stripe Checkout, Vitest, pnpm.

---

## File Map

- Modify `apps/webapp/src/db/schema/billing.ts`: make `stripeCustomerId` nullable and keep the unique index usable for real Stripe customers.
- Create `apps/webapp/drizzle/0023_billing_local_trials.sql`: migrate `subscription.stripe_customer_id` to nullable and replace the unique index with a partial unique index for non-null values.
- Modify `apps/webapp/src/lib/effect/services/billing/subscription.service.ts`: support local trial creation, nullable customer IDs, active-state helpers, and remaining trial day calculation.
- Create `apps/webapp/src/lib/effect/services/billing/billing-access.ts`: pure state machine for allowed/suspended billing access decisions.
- Modify `apps/webapp/src/lib/effect/services/billing/billing-enforcement.service.ts`: use the pure state machine, create lazy trials when enabled, and expose page/mutation guard semantics.
- Modify `apps/webapp/src/lib/effect/services/billing/stripe.service.ts`: omit `trial_period_days` when no trial remains and preserve organization metadata.
- Modify `apps/webapp/src/app/api/billing/checkout/route.ts`: use existing local trial, pass remaining trial days, and keep billing recovery available for suspended admins.
- Modify `apps/webapp/src/app/api/billing/subscription/route.ts`: return access-state fields needed by UI.
- Modify `apps/webapp/src/app/[locale]/(app)/layout.tsx`: enforce page access and render the trial banner.
- Create `apps/webapp/src/components/billing/trial-banner.tsx`: localized trial banner with upgrade action.
- Create `apps/webapp/src/app/[locale]/(app)/billing/suspended/page.tsx`: localized suspended recovery route.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/billing/page.tsx`: exempt billing recovery from page suspension and show admin/non-admin recovery correctly.
- Modify `apps/webapp/src/components/billing/billing-page-client.tsx`: update trial/Checkout copy and localized errors.
- Create `apps/webapp/src/lib/billing/guard.ts`: reusable helpers for mutating API routes and server actions.
- Modify representative org-scoped mutation entry points in this first pass: `apps/webapp/src/app/api/time-entries/route.ts`, `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts`, and `apps/webapp/src/app/[locale]/(app)/settings/organization/actions.ts` if present.
- Modify `apps/webapp/src/lib/effect/services/billing/billing-events.service.ts`: ensure cancellation and scheduled cancellation state remains consistent.
- Modify `apps/docs/content/docs/guide/admin-guide/billing.mdx`: update trial, Checkout, suspension, and cancellation behavior.
- Add or modify tests next to changed modules.

## Task 1: Schema Support For Local Trials

**Files:**
- Modify: `apps/webapp/src/db/schema/billing.ts`
- Create: `apps/webapp/drizzle/0023_billing_local_trials.sql`
- Test: `apps/webapp/src/db/schema/__tests__/billing-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `apps/webapp/src/db/schema/__tests__/billing-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { subscription } from "@/db/schema/billing";

describe("billing schema", () => {
	it("allows local trial rows without a Stripe customer", () => {
		const trialRow: typeof subscription.$inferInsert = {
			organizationId: "org_123",
			status: "trialing",
			trialStart: new Date("2026-05-20T00:00:00.000Z"),
			trialEnd: new Date("2026-06-03T00:00:00.000Z"),
			currentSeats: 0,
		};

		expect(trialRow.stripeCustomerId).toBeUndefined();
		expect(trialRow.status).toBe("trialing");
	});
});
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run: `pnpm --dir apps/webapp test src/db/schema/__tests__/billing-schema.test.ts`

Expected: TypeScript or Vitest failure showing `stripeCustomerId` is required for `subscription.$inferInsert`.

- [ ] **Step 3: Update the Drizzle schema**

In `apps/webapp/src/db/schema/billing.ts`, change the Stripe customer column and index:

```ts
		// Stripe IDs
		stripeCustomerId: text("stripe_customer_id"),
		stripeSubscriptionId: text("stripe_subscription_id"),
		stripePriceId: text("stripe_price_id"),
```

Keep the index declaration as:

```ts
		uniqueIndex("subscription_stripe_customer_id_idx")
			.on(table.stripeCustomerId)
			.where(sql`${table.stripeCustomerId} is not null`),
```

Also add `sql` to the imports from `drizzle-orm` at the top of the file:

```ts
import { sql } from "drizzle-orm";
```

- [ ] **Step 4: Create the SQL migration**

Create `apps/webapp/drizzle/0023_billing_local_trials.sql`:

```sql
DROP INDEX IF EXISTS "subscription_stripe_customer_id_idx";

ALTER TABLE "subscription"
	ALTER COLUMN "stripe_customer_id" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_stripe_customer_id_idx"
	ON "subscription" ("stripe_customer_id")
	WHERE "stripe_customer_id" IS NOT NULL;
```

- [ ] **Step 5: Run the schema test to verify it passes**

Run: `pnpm --dir apps/webapp test src/db/schema/__tests__/billing-schema.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/db/schema/billing.ts apps/webapp/drizzle/0023_billing_local_trials.sql apps/webapp/src/db/schema/__tests__/billing-schema.test.ts
git commit -m "feat: allow local billing trials"
```

## Task 2: Pure Billing Access State Machine

**Files:**
- Create: `apps/webapp/src/lib/effect/services/billing/billing-access.ts`
- Test: `apps/webapp/src/lib/effect/services/billing/billing-access.test.ts`

- [ ] **Step 1: Write the failing access tests**

Create `apps/webapp/src/lib/effect/services/billing/billing-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { evaluateBillingAccess } from "./billing-access";

const now = new Date("2026-05-20T12:00:00.000Z");

describe("evaluateBillingAccess", () => {
	it("allows when billing is disabled", () => {
		expect(evaluateBillingAccess({ billingEnabled: false, subscription: null, now })).toEqual({
			canAccess: true,
			state: "disabled",
		});
	});

	it("allows a valid trial", () => {
		expect(
			evaluateBillingAccess({
				billingEnabled: true,
				now,
				subscription: { status: "trialing", trialEnd: new Date("2026-05-25T00:00:00.000Z"), cancelAt: null },
			}),
		).toMatchObject({ canAccess: true, state: "trialing", daysRemaining: 5 });
	});

	it("suspends an expired trial", () => {
		expect(
			evaluateBillingAccess({
				billingEnabled: true,
				now,
				subscription: { status: "trialing", trialEnd: new Date("2026-05-19T00:00:00.000Z"), cancelAt: null },
			}),
		).toMatchObject({ canAccess: false, state: "suspended", reason: "trial_expired" });
	});

	it("allows active subscriptions even when cancellation is scheduled", () => {
		expect(
			evaluateBillingAccess({
				billingEnabled: true,
				now,
				subscription: { status: "active", trialEnd: null, cancelAt: new Date("2026-06-01T00:00:00.000Z") },
			}),
		).toMatchObject({ canAccess: true, state: "active" });
	});

	it.each(["past_due", "unpaid", "incomplete", "incomplete_expired", "canceled", "paused"])(
		"suspends status %s",
		(status) => {
			expect(
				evaluateBillingAccess({
					billingEnabled: true,
					now,
					subscription: { status, trialEnd: null, cancelAt: null },
				}),
			).toMatchObject({ canAccess: false, state: "suspended" });
		},
	);

	it("requires subscription when billing is enabled and no row exists", () => {
		expect(evaluateBillingAccess({ billingEnabled: true, subscription: null, now })).toEqual({
			canAccess: false,
			state: "suspended",
			reason: "subscription_required",
		});
	});
});
```

- [ ] **Step 2: Run the access tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/effect/services/billing/billing-access.test.ts`

Expected: FAIL because `billing-access.ts` does not exist.

- [ ] **Step 3: Implement the pure state machine**

Create `apps/webapp/src/lib/effect/services/billing/billing-access.ts`:

```ts
export type BillingSuspensionReason =
	| "subscription_required"
	| "trial_expired"
	| "payment_failed"
	| "canceled";

export type BillingAccessState = "disabled" | "trialing" | "active" | "suspended";

export interface BillingAccessSubscriptionInput {
	status: string;
	trialEnd: Date | null;
	cancelAt: Date | null;
}

export interface BillingAccessResult {
	canAccess: boolean;
	state: BillingAccessState;
	reason?: BillingSuspensionReason;
	trialEndsAt?: Date | null;
	status?: string;
	daysRemaining?: number;
}

export function evaluateBillingAccess(input: {
	billingEnabled: boolean;
	subscription: BillingAccessSubscriptionInput | null;
	now?: Date;
}): BillingAccessResult {
	if (!input.billingEnabled) {
		return { canAccess: true, state: "disabled" };
	}

	const now = input.now ?? new Date();
	const sub = input.subscription;

	if (!sub) {
		return { canAccess: false, state: "suspended", reason: "subscription_required" };
	}

	if (sub.status === "trialing") {
		if (sub.trialEnd && sub.trialEnd > now) {
			return {
				canAccess: true,
				state: "trialing",
				status: sub.status,
				trialEndsAt: sub.trialEnd,
				daysRemaining: getDaysRemaining(sub.trialEnd, now),
			};
		}

		return {
			canAccess: false,
			state: "suspended",
			reason: "trial_expired",
			status: sub.status,
			trialEndsAt: sub.trialEnd,
		};
	}

	if (sub.status === "active") {
		return { canAccess: true, state: "active", status: sub.status };
	}

	if (sub.status === "past_due") {
		return { canAccess: false, state: "suspended", reason: "payment_failed", status: sub.status };
	}

	if (sub.status === "canceled" || sub.status === "unpaid") {
		return { canAccess: false, state: "suspended", reason: "canceled", status: sub.status };
	}

	return { canAccess: false, state: "suspended", reason: "subscription_required", status: sub.status };
}

export function getDaysRemaining(end: Date, now: Date = new Date()): number {
	const millisecondsPerDay = 24 * 60 * 60 * 1000;
	return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / millisecondsPerDay));
}
```

- [ ] **Step 4: Run the access tests to verify they pass**

Run: `pnpm --dir apps/webapp test src/lib/effect/services/billing/billing-access.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/effect/services/billing/billing-access.ts apps/webapp/src/lib/effect/services/billing/billing-access.test.ts
git commit -m "feat: add billing access state machine"
```

## Task 3: Subscription Service Local Trial APIs

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/billing/subscription.service.ts`
- Test: `apps/webapp/src/lib/effect/services/billing/subscription.service.test.ts`

- [ ] **Step 1: Add failing tests for local trial creation and remaining days**

Append to `apps/webapp/src/lib/effect/services/billing/subscription.service.test.ts`:

```ts
	it("creates a local trial without a Stripe customer", async () => {
		findFirst.mockResolvedValueOnce(null);
		const now = new Date("2026-05-20T00:00:00.000Z");

		await Effect.runPromise(
			Effect.gen(function* () {
				const subscriptionService = yield* SubscriptionService;
				yield* subscriptionService.ensureLocalTrial({ organizationId: "org_123", now });
			}).pipe(Effect.provide(SubscriptionServiceLive)),
		);

		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org_123",
				stripeCustomerId: null,
				status: "trialing",
				trialStart: now,
				trialEnd: new Date("2026-06-03T00:00:00.000Z"),
			}),
		);
	});

	it("does not replace an existing billing row when ensuring a local trial", async () => {
		findFirst.mockResolvedValueOnce({ organizationId: "org_123", status: "active", stripeCustomerId: "cus_123" });

		await Effect.runPromise(
			Effect.gen(function* () {
				const subscriptionService = yield* SubscriptionService;
				const result = yield* subscriptionService.ensureLocalTrial({
					organizationId: "org_123",
					now: new Date("2026-05-20T00:00:00.000Z"),
				});
				expect(result.status).toBe("active");
			}).pipe(Effect.provide(SubscriptionServiceLive)),
		);

		expect(insertValues).not.toHaveBeenCalled();
	});
```

- [ ] **Step 2: Run subscription tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/effect/services/billing/subscription.service.test.ts`

Expected: FAIL because `ensureLocalTrial` is not defined.

- [ ] **Step 3: Extend service types and implementation**

In `apps/webapp/src/lib/effect/services/billing/subscription.service.ts`, change `SubscriptionInfo` and create params:

```ts
export interface SubscriptionInfo {
	id: string;
	organizationId: string;
	stripeCustomerId: string | null;
	stripeSubscriptionId: string | null;
	status: string;
	isActive: boolean;
	isTrialing: boolean;
	isPastDue: boolean;
	currentSeats: number;
	trialStart: Date | null;
	trialEnd: Date | null;
	currentPeriodEnd: Date | null;
	billingInterval: string | null;
	cancelAt: Date | null;
}
```

Add to the service interface:

```ts
		readonly ensureLocalTrial: (params: {
			organizationId: string;
			now?: Date;
		}) => Effect.Effect<SubscriptionInfo, DatabaseError>;
```

Update `mapToSubscriptionInfo` to include `trialStart` and allow nullable customer IDs:

```ts
		stripeCustomerId: sub.stripeCustomerId,
		trialStart: sub.trialStart,
```

Add implementation before `create`:

```ts
		ensureLocalTrial: ({ organizationId, now = new Date() }) =>
			Effect.tryPromise({
				try: async () => {
					const existing = await db.query.subscription.findFirst({
						where: eq(subscription.organizationId, organizationId),
					});

					if (existing) return mapToSubscriptionInfo(existing);

					const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
					const [created] = await db
						.insert(subscription)
						.values({
							organizationId,
							stripeCustomerId: null,
							status: "trialing",
							trialStart: now,
							trialEnd,
							currentSeats: 0,
						})
						.onConflictDoNothing({ target: subscription.organizationId })
						.returning();

					if (created) return mapToSubscriptionInfo(created);

					const raced = await db.query.subscription.findFirst({
						where: eq(subscription.organizationId, organizationId),
					});
					if (!raced) throw new Error("Failed to create local trial");
					return mapToSubscriptionInfo(raced);
				},
				catch: (error) =>
					new DatabaseError({
						message: "Failed to ensure local trial",
						operation: "ensureLocalTrial",
						table: "subscription",
						cause: error,
					}),
			}),
```

Update `setStripeCustomerId` so new rows use nullable local-trial-compatible data:

```ts
						await db.insert(subscription).values({
							organizationId,
							stripeCustomerId,
							status: "incomplete",
							currentSeats: 0,
						});
```

- [ ] **Step 4: Run subscription tests to verify they pass**

Run: `pnpm --dir apps/webapp test src/lib/effect/services/billing/subscription.service.test.ts`

Expected: PASS. If the mock chain lacks `onConflictDoNothing` and `returning`, extend the mock in this same test file with chain functions rather than weakening the implementation.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/effect/services/billing/subscription.service.ts apps/webapp/src/lib/effect/services/billing/subscription.service.test.ts
git commit -m "feat: add local trial subscriptions"
```

## Task 4: Enforcement Service Uses Trial Creation And State Machine

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/billing/billing-enforcement.service.ts`
- Create: `apps/webapp/src/lib/effect/services/billing/billing-enforcement.service.test.ts`

- [ ] **Step 1: Write failing enforcement tests**

Create `apps/webapp/src/lib/effect/services/billing/billing-enforcement.service.test.ts` with mocked DB rows:

```ts
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingEnforcementService, BillingEnforcementServiceLive } from "./billing-enforcement.service";

const { findFirst, insertValues, onConflictDoNothing, returning } = vi.hoisted(() => ({
	findFirst: vi.fn(),
	insertValues: vi.fn(),
	onConflictDoNothing: vi.fn(),
	returning: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: { subscription: { findFirst } },
		insert: vi.fn(() => ({
			values: insertValues,
		})),
	},
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	eq: vi.fn((column, value) => ({ column, value })),
}));

describe("BillingEnforcementService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv("BILLING_ENABLED", "true");
		insertValues.mockReturnValue({ onConflictDoNothing });
		onConflictDoNothing.mockReturnValue({ returning });
	});

	it("creates a lazy local trial when billing is enabled and no row exists", async () => {
		const created = {
			id: "sub_1",
			organizationId: "org_123",
			stripeCustomerId: null,
			stripeSubscriptionId: null,
			status: "trialing",
			trialStart: new Date("2026-05-20T00:00:00.000Z"),
			trialEnd: new Date("2026-06-03T00:00:00.000Z"),
			currentSeats: 0,
			currentPeriodEnd: null,
			billingInterval: null,
			cancelAt: null,
		};
		findFirst.mockResolvedValueOnce(null);
		returning.mockResolvedValueOnce([created]);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* BillingEnforcementService;
				return yield* service.checkBillingAccess("org_123", { now: new Date("2026-05-20T00:00:00.000Z") });
			}).pipe(Effect.provide(BillingEnforcementServiceLive)),
		);

		expect(result).toMatchObject({ canAccess: true, state: "trialing", daysRemaining: 14 });
	});

	it("fails requireActiveSubscription for canceled organizations", async () => {
		findFirst.mockResolvedValueOnce({
			status: "canceled",
			trialEnd: null,
			cancelAt: null,
		});

		await expect(
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* BillingEnforcementService;
					yield* service.requireActiveSubscription("org_123");
				}).pipe(Effect.provide(BillingEnforcementServiceLive)),
			),
		).rejects.toThrow(/Subscription is not active|canceled|subscription/i);
	});
});
```

- [ ] **Step 2: Run enforcement tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/effect/services/billing/billing-enforcement.service.test.ts`

Expected: FAIL because `checkBillingAccess` does not accept the optional clock and does not create trials.

- [ ] **Step 3: Update enforcement service interface**

In `apps/webapp/src/lib/effect/services/billing/billing-enforcement.service.ts`, import the state machine:

```ts
import { evaluateBillingAccess, type BillingAccessResult } from "./billing-access";
```

Update `BillingAccessResult` by removing the local interface or re-exporting the imported one:

```ts
export type { BillingAccessResult } from "./billing-access";
```

Change `checkBillingAccess` signature:

```ts
		readonly checkBillingAccess: (
			organizationId: string,
			options?: { now?: Date; createTrialIfMissing?: boolean },
		) => Effect.Effect<BillingAccessResult, DatabaseError>;
```

- [ ] **Step 4: Implement lazy trial and state-machine evaluation**

Replace the `checkBillingAccess` implementation with:

```ts
		checkBillingAccess: (organizationId, options) =>
			Effect.gen(function* () {
				const billingEnabled = process.env.BILLING_ENABLED === "true";
				if (!billingEnabled) {
					return evaluateBillingAccess({ billingEnabled: false, subscription: null, now: options?.now });
				}

				let sub = yield* Effect.tryPromise({
					try: async () =>
						await db.query.subscription.findFirst({
							where: eq(subscription.organizationId, organizationId),
						}),
					catch: (error) =>
						new DatabaseError({
							message: "Failed to check billing access",
							operation: "checkBillingAccess",
							table: "subscription",
							cause: error,
						}),
				});

				if (!sub && options?.createTrialIfMissing !== false) {
					const now = options?.now ?? new Date();
					const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
					const [created] = yield* Effect.tryPromise({
						try: async () =>
							await db
								.insert(subscription)
								.values({
									organizationId,
									stripeCustomerId: null,
									status: "trialing",
									trialStart: now,
									trialEnd,
									currentSeats: 0,
								})
								.onConflictDoNothing({ target: subscription.organizationId })
								.returning(),
						catch: (error) =>
							new DatabaseError({
								message: "Failed to create local trial",
								operation: "checkBillingAccess.createTrial",
								table: "subscription",
								cause: error,
							}),
					});
					sub = created ?? null;
				}

				return evaluateBillingAccess({
					billingEnabled: true,
					now: options?.now,
					subscription: sub
						? { status: sub.status, trialEnd: sub.trialEnd, cancelAt: sub.cancelAt }
						: null,
				});
			}),
```

Update `requireActiveSubscription` to call `checkBillingAccess` and fail on `!canAccess`, preserving existing `BillingError` reasons.

- [ ] **Step 5: Run enforcement tests to verify they pass**

Run: `pnpm --dir apps/webapp test src/lib/effect/services/billing/billing-enforcement.service.test.ts src/lib/effect/services/billing/billing-access.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/lib/effect/services/billing/billing-enforcement.service.ts apps/webapp/src/lib/effect/services/billing/billing-enforcement.service.test.ts
git commit -m "feat: enforce billing access states"
```

## Task 5: Stripe Checkout Uses Remaining Trial Days

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/billing/stripe.service.ts`
- Modify: `apps/webapp/src/lib/effect/services/billing/stripe.service.test.ts`
- Modify: `apps/webapp/src/app/api/billing/checkout/route.ts`

- [ ] **Step 1: Add failing Stripe service tests**

Append to `apps/webapp/src/lib/effect/services/billing/stripe.service.test.ts`:

```ts
	it("passes remaining trial days to subscription Checkout", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const stripeService = yield* StripeService;
				yield* stripeService.createCheckoutSession({
					customerId: "cus_test_123",
					priceId: "price_monthly_123",
					organizationId: "org_123",
					quantity: 5,
					successUrl: "https://app.test/settings/billing?success=true",
					cancelUrl: "https://app.test/settings/billing?canceled=true",
					trialPeriodDays: 3,
				});
			}).pipe(Effect.provide(StripeServiceLive)),
		);

		expect(checkoutSessionsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				subscription_data: expect.objectContaining({ trial_period_days: 3 }),
			}),
		);
	});

	it("omits trial days from Checkout when no trial remains", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const stripeService = yield* StripeService;
				yield* stripeService.createCheckoutSession({
					customerId: "cus_test_123",
					priceId: "price_monthly_123",
					organizationId: "org_123",
					quantity: 5,
					successUrl: "https://app.test/settings/billing?success=true",
					cancelUrl: "https://app.test/settings/billing?canceled=true",
					trialPeriodDays: 0,
				});
			}).pipe(Effect.provide(StripeServiceLive)),
		);

		expect(checkoutSessionsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				subscription_data: expect.not.objectContaining({ trial_period_days: expect.any(Number) }),
			}),
		);
	});
```

- [ ] **Step 2: Run Stripe tests to verify the zero-days test fails**

Run: `pnpm --dir apps/webapp test src/lib/effect/services/billing/stripe.service.test.ts`

Expected: FAIL because the service currently forwards `trial_period_days: 0` or undefined directly.

- [ ] **Step 3: Update Stripe service Checkout payload**

In `apps/webapp/src/lib/effect/services/billing/stripe.service.ts`, build subscription data before `stripe.checkout.sessions.create`:

```ts
						const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
							metadata: { organizationId: params.organizationId },
						};

						if (params.trialPeriodDays && params.trialPeriodDays > 0) {
							subscriptionData.trial_period_days = params.trialPeriodDays;
						}
```

Then pass:

```ts
							subscription_data: subscriptionData,
```

- [ ] **Step 4: Update checkout route to use remaining trial**

In `apps/webapp/src/app/api/billing/checkout/route.ts`, import `getDaysRemaining`:

```ts
import { getDaysRemaining } from "@/lib/effect/services/billing/billing-access";
```

Before creating Checkout, replace the hardcoded `trialPeriodDays: 14` with:

```ts
		const remainingTrialDays = existing?.status === "trialing" && existing.trialEnd
			? getDaysRemaining(existing.trialEnd)
			: 0;
```

Pass:

```ts
			trialPeriodDays: remainingTrialDays,
```

Keep the duplicate subscription guard, but allow local trial rows without `stripeSubscriptionId`:

```ts
		if (existing?.stripeSubscriptionId && existing.status !== "canceled") {
			return yield* Effect.fail(new Error("Organization already has an active subscription"));
		}
```

- [ ] **Step 5: Run Stripe tests**

Run: `pnpm --dir apps/webapp test src/lib/effect/services/billing/stripe.service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/lib/effect/services/billing/stripe.service.ts apps/webapp/src/lib/effect/services/billing/stripe.service.test.ts apps/webapp/src/app/api/billing/checkout/route.ts
git commit -m "feat: preserve remaining trial in checkout"
```

## Task 6: Trial Banner In App Layout

**Files:**
- Create: `apps/webapp/src/components/billing/trial-banner.tsx`
- Create: `apps/webapp/src/components/billing/trial-banner.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/layout.tsx`

- [ ] **Step 1: Write the failing banner component tests**

Create `apps/webapp/src/components/billing/trial-banner.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TrialBanner } from "./trial-banner";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace("{days}", String(params?.days ?? "")),
	}),
}));

describe("TrialBanner", () => {
	it("shows remaining days and upgrade copy", () => {
		render(<TrialBanner daysRemaining={9} billingHref="/settings/billing" />);

		expect(screen.getByText("14-day trial active")).toBeTruthy();
		expect(
			screen.getByText("9 days remaining. Add payment details now; your paid subscription starts after the trial."),
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Upgrade" }).getAttribute("href")).toBe("/settings/billing");
	});
});
```

- [ ] **Step 2: Run banner test to verify it fails**

Run: `pnpm --dir apps/webapp test src/components/billing/trial-banner.test.tsx`

Expected: FAIL because `trial-banner.tsx` does not exist.

- [ ] **Step 3: Implement the localized banner**

Create `apps/webapp/src/components/billing/trial-banner.tsx`:

```tsx
"use client";

import { IconCreditCard } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export function TrialBanner({ daysRemaining, billingHref }: { daysRemaining: number; billingHref: string }) {
	const { t } = useTranslate();

	return (
		<div className="border-b border-blue-200 bg-blue-50 px-4 py-3 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-50">
			<div className="mx-auto flex max-w-screen-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-start gap-3">
					<IconCreditCard className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
					<div>
						<p className="font-medium">{t("billing.trialBanner.title", "14-day trial active")}</p>
						<p className="text-sm text-blue-800 dark:text-blue-100">
							{t(
								"billing.trialBanner.description",
								"{days} days remaining. Add payment details now; your paid subscription starts after the trial.",
								{ days: daysRemaining },
							)}
						</p>
					</div>
				</div>
				<Button asChild size="sm">
					<Link href={billingHref}>{t("billing.trialBanner.upgrade", "Upgrade")}</Link>
				</Button>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Wire the banner into the app layout**

In `apps/webapp/src/app/[locale]/(app)/layout.tsx`, import the banner and enforcement service:

```ts
import { Effect } from "effect";
import { TrialBanner } from "@/components/billing/trial-banner";
import { BillingEnforcementService, BillingEnforcementServiceLive } from "@/lib/effect/services/billing/billing-enforcement.service";
```

After locale preference checks and before `return`, compute access if an active org exists:

```ts
	const billingAccess = session.session?.activeOrganizationId
		? await Effect.runPromise(
				Effect.gen(function* () {
					const billing = yield* BillingEnforcementService;
					return yield* billing.checkBillingAccess(session.session.activeOrganizationId);
				}).pipe(Effect.provide(BillingEnforcementServiceLive)),
			)
		: { canAccess: true, state: "disabled" as const };
```

Inside the layout, render above `OrganizationDeletionBanner`:

```tsx
							{billingAccess.state === "trialing" && billingAccess.daysRemaining ? (
								<TrialBanner daysRemaining={billingAccess.daysRemaining} billingHref={`/${locale}/settings/billing`} />
							) : null}
```

- [ ] **Step 5: Run banner test**

Run: `pnpm --dir apps/webapp test src/components/billing/trial-banner.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/components/billing/trial-banner.tsx apps/webapp/src/components/billing/trial-banner.test.tsx apps/webapp/src/app/[locale]/\(app\)/layout.tsx
git commit -m "feat: show billing trial banner"
```

## Task 7: Suspended Page Access And Recovery Route

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/layout.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/billing/suspended/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/billing/suspended/page.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/billing/page.tsx`

- [ ] **Step 1: Write failing source-level route access test**

Create `apps/webapp/src/app/[locale]/(app)/billing/suspended/page.test.tsx`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(process.cwd(), "src/app/[locale]/(app)");

describe("billing suspended route", () => {
	it("has a suspended recovery page", () => {
		expect(existsSync(join(APP_ROOT, "billing/suspended/page.tsx"))).toBe(true);
	});

	it("app layout redirects suspended orgs but exempts billing recovery", () => {
		const source = readFileSync(join(APP_ROOT, "layout.tsx"), "utf8");
		expect(source).toContain("/billing/suspended");
		expect(source).toContain("isBillingRecoveryPath");
		expect(source).toContain("billingAccess.canAccess");
	});
});
```

- [ ] **Step 2: Run suspended route test to verify it fails**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/billing/suspended/page.test.tsx'`

Expected: FAIL because the route does not exist and layout lacks the redirect.

- [ ] **Step 3: Add suspended route**

Create `apps/webapp/src/app/[locale]/(app)/billing/suspended/page.tsx`:

```tsx
import { IconLock } from "@tabler/icons-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAbility } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function BillingSuspendedPage({ params }: { params: Promise<{ locale: string }> }) {
	const { locale } = await params;
	const t = await getTranslate();
	const ability = await getAbility();
	const canManageBilling = Boolean(ability && ability.can("manage", "OrgBilling"));

	return (
		<div className="flex min-h-[60vh] items-center justify-center p-6">
			<Card className="w-full max-w-xl">
				<CardHeader>
					<div className="mb-3 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
						<IconLock className="size-6" aria-hidden="true" />
					</div>
					<CardTitle>{t("billing.suspended.title", "Organization suspended")}</CardTitle>
					<CardDescription>
						{canManageBilling
							? t(
									"billing.suspended.adminDescription",
									"Your trial ended or subscription is no longer valid. Update billing to continue using Z8.",
								)
							: t(
									"billing.suspended.memberDescription",
									"This organization is suspended. Contact an organization admin to update billing.",
								)}
					</CardDescription>
				</CardHeader>
				{canManageBilling ? (
					<CardContent>
						<Button asChild>
							<Link href={`/${locale}/settings/billing`}>
								{t("billing.suspended.goToBilling", "Go to billing")}
							</Link>
						</Button>
					</CardContent>
				) : null}
			</Card>
		</div>
	);
}
```

- [ ] **Step 4: Redirect suspended orgs from the app layout**

In `apps/webapp/src/app/[locale]/(app)/layout.tsx`, use the pathname header already read from `headersList`:

```ts
	const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
	const isBillingRecoveryPath = pathname.includes("/settings/billing") || pathname.includes("/billing/suspended");
	if (!billingAccess.canAccess && !isBillingRecoveryPath) {
		redirect(`/${locale}/billing/suspended`);
	}
```

Place this after `billingAccess` is computed and before the JSX return. Keep billing settings reachable to avoid loops.

- [ ] **Step 5: Run suspended route test**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/billing/suspended/page.test.tsx'`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/layout.tsx apps/webapp/src/app/[locale]/\(app\)/billing/suspended/page.tsx apps/webapp/src/app/[locale]/\(app\)/billing/suspended/page.test.tsx apps/webapp/src/app/[locale]/\(app\)/settings/billing/page.tsx
git commit -m "feat: block suspended organizations"
```

## Task 8: Billing Page Copy And Recovery Behavior

**Files:**
- Modify: `apps/webapp/src/components/billing/billing-page-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/billing/page.tsx`
- Test: existing billing/settings tests plus optional new component test if practical.

- [ ] **Step 1: Add a source-level test for required localized copy**

Create `apps/webapp/src/components/billing/billing-page-client.test.tsx` if it does not exist, or append to it if it exists:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("BillingPageClient source", () => {
	it("uses localized copy for trial payment timing", () => {
		const source = readFileSync(join(process.cwd(), "src/components/billing/billing-page-client.tsx"), "utf8");
		expect(source).toContain("billing.checkout.trialContinuesTitle");
		expect(source).toContain("billing.checkout.trialContinuesDescription");
		expect(source).toContain("useTranslate");
	});
});
```

- [ ] **Step 2: Run the billing page test to verify it fails**

Run: `pnpm --dir apps/webapp test src/components/billing/billing-page-client.test.tsx`

Expected: FAIL because the new translation keys are not present.

- [ ] **Step 3: Add localized Checkout timing copy**

In `apps/webapp/src/components/billing/billing-page-client.tsx`, add an `Alert` near the pricing cards when `subscription?.status === "trialing"`:

```tsx
			{subscription?.status === "trialing" ? (
				<Alert className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40">
					<IconCreditCard className="size-4" />
					<AlertTitle>{t("billing.checkout.trialContinuesTitle", "Your trial continues after upgrade")}</AlertTitle>
					<AlertDescription>
						{t(
							"billing.checkout.trialContinuesDescription",
							"Stripe Checkout collects payment details now. Your paid subscription starts only after the trial expires.",
						)}
					</AlertDescription>
				</Alert>
			) : null}
```

Ensure any new fallback strings are wrapped in `t()`.

- [ ] **Step 4: Run billing page test**

Run: `pnpm --dir apps/webapp test src/components/billing/billing-page-client.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/components/billing/billing-page-client.tsx apps/webapp/src/components/billing/billing-page-client.test.tsx apps/webapp/src/app/[locale]/\(app\)/settings/billing/page.tsx
git commit -m "feat: clarify trial checkout billing"
```

## Task 9: Mutation Guard For Org-Scoped Writes

**Files:**
- Create: `apps/webapp/src/lib/billing/guard.ts`
- Create: `apps/webapp/src/lib/billing/guard.test.ts`
- Modify representative mutation routes/actions found in this repo.

- [ ] **Step 1: Write failing guard tests**

Create `apps/webapp/src/lib/billing/guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createBillingForbiddenResponse, isBillingMutationAllowed } from "./guard";

describe("billing mutation guard helpers", () => {
	it("allows mutations when access is allowed", () => {
		expect(isBillingMutationAllowed({ canAccess: true, state: "active" })).toBe(true);
	});

	it("blocks mutations when access is suspended", () => {
		expect(
			isBillingMutationAllowed({
				canAccess: false,
				state: "suspended",
				reason: "trial_expired",
			}),
		).toBe(false);
	});

	it("creates a stable forbidden API response body", async () => {
		const response = createBillingForbiddenResponse({
			canAccess: false,
			state: "suspended",
			reason: "trial_expired",
		});
		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({
			error: "billing_required",
			reason: "trial_expired",
		});
	});
});
```

- [ ] **Step 2: Run guard tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/billing/guard.test.ts`

Expected: FAIL because `guard.ts` does not exist.

- [ ] **Step 3: Implement guard helpers**

Create `apps/webapp/src/lib/billing/guard.ts`:

```ts
import { Effect } from "effect";
import { NextResponse } from "next/server";

import {
	BillingEnforcementService,
	BillingEnforcementServiceLive,
} from "@/lib/effect/services/billing/billing-enforcement.service";
import type { BillingAccessResult } from "@/lib/effect/services/billing/billing-access";

export function isBillingMutationAllowed(access: Pick<BillingAccessResult, "canAccess">): boolean {
	return access.canAccess;
}

export function createBillingForbiddenResponse(access: BillingAccessResult): NextResponse {
	return NextResponse.json(
		{ error: "billing_required", reason: access.reason ?? "subscription_required" },
		{ status: 402 },
	);
}

export async function requireBillingForMutation(organizationId: string): Promise<BillingAccessResult> {
	return await Effect.runPromise(
		Effect.gen(function* () {
			const billing = yield* BillingEnforcementService;
			return yield* billing.checkBillingAccess(organizationId, { createTrialIfMissing: true });
		}).pipe(Effect.provide(BillingEnforcementServiceLive)),
	);
}
```

- [ ] **Step 4: Wire guard into representative mutating entry points**

For each mutating API route with an active org ID, add this pattern after auth/org authorization and before writes:

```ts
const billingAccess = await requireBillingForMutation(organizationId);
if (!isBillingMutationAllowed(billingAccess)) {
	return createBillingForbiddenResponse(billingAccess);
}
```

For server actions, add this pattern after resolving and authorizing `organizationId`:

```ts
const billingAccess = await requireBillingForMutation(organizationId);
if (!isBillingMutationAllowed(billingAccess)) {
	return { ok: false, error: "billing_required", reason: billingAccess.reason };
}
```

Apply this first to:

- `apps/webapp/src/app/api/time-entries/route.ts` for POST/PATCH/DELETE handlers that mutate time data.
- `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts` before create/update/cancel absence mutations.
- `apps/webapp/src/app/[locale]/(app)/settings/organization/actions.ts` if the file exists; otherwise document in the task commit message that no such file exists and skip it.

- [ ] **Step 5: Run guard tests and representative mutation tests**

Run: `pnpm --dir apps/webapp test src/lib/billing/guard.test.ts 'src/app/[locale]/(app)/absences/mutations.test.ts'`

Expected: PASS. If `api/time-entries` has a focused route test, include it in this command.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/lib/billing/guard.ts apps/webapp/src/lib/billing/guard.test.ts apps/webapp/src/app/api/time-entries/route.ts apps/webapp/src/app/[locale]/\(app\)/absences/mutations.ts
test ! -f apps/webapp/src/app/[locale]/\(app\)/settings/organization/actions.ts || git add apps/webapp/src/app/[locale]/\(app\)/settings/organization/actions.ts
git commit -m "feat: guard org mutations by billing state"
```

## Task 10: Webhook Cancellation Semantics

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/billing/billing-events.service.ts`
- Create or modify: `apps/webapp/src/lib/effect/services/billing/billing-events.service.test.ts`

- [ ] **Step 1: Write webhook semantics tests**

Create `apps/webapp/src/lib/effect/services/billing/billing-events.service.test.ts` if it does not exist. If existing mocks are complex, test `SubscriptionService.updateFromStripe` payloads through extracted handlers or source-level assertions:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("billing webhook cancellation semantics", () => {
	it("updates scheduled cancellation without forcing canceled status", () => {
		const source = readFileSync(
			join(process.cwd(), "src/lib/effect/services/billing/billing-events.service.ts"),
			"utf8",
		);
		expect(source).toContain("status: stripeSub.status");
		expect(source).toContain("cancelAt: stripeSub.cancel_at");
	});

	it("marks deleted subscriptions as canceled", () => {
		const source = readFileSync(
			join(process.cwd(), "src/lib/effect/services/billing/billing-events.service.ts"),
			"utf8",
		);
		expect(source).toContain('status: "canceled"');
		expect(source).toContain("handleSubscriptionDeleted");
	});
});
```

- [ ] **Step 2: Run webhook test**

Run: `pnpm --dir apps/webapp test src/lib/effect/services/billing/billing-events.service.test.ts`

Expected: PASS if current semantics already match. If it fails, update the webhook handlers to preserve `stripeSub.status` on updates and only force `canceled` in delete/canceled events.

- [ ] **Step 3: Commit if changes were needed**

If only tests were added:

```bash
git add apps/webapp/src/lib/effect/services/billing/billing-events.service.test.ts
git commit -m "test: cover billing cancellation webhooks"
```

If handler changes were needed:

```bash
git add apps/webapp/src/lib/effect/services/billing/billing-events.service.ts apps/webapp/src/lib/effect/services/billing/billing-events.service.test.ts
git commit -m "fix: preserve scheduled cancellation access"
```

## Task 11: Documentation Update

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/billing.mdx`

- [ ] **Step 1: Update billing documentation**

In `apps/docs/content/docs/guide/admin-guide/billing.mdx`, update these sections:

```mdx
New organizations receive a **14-day free trial** when billing is enabled:

- Full access to all features during the trial
- No credit card is required to start the trial
- A trial countdown appears in the app while the trial is active
- Organization admins can add payment details during the trial with Stripe Checkout
- If payment details are added during the trial, the paid subscription starts after the trial expires
```

Replace read-only cancellation language with:

```mdx
After your trial expires or your subscription is no longer valid, your organization is suspended. Normal product pages and data-changing actions are blocked until an organization admin updates billing.
```

Replace cancellation timing language with:

```mdx
If a cancellation is scheduled for the end of the billing period, access remains active while Stripe reports the subscription as active. When Stripe reports the subscription as canceled, the organization is suspended immediately.
```

- [ ] **Step 2: Verify docs no longer promise read-only mode**

Run: `pnpm --dir apps/docs test -- --runInBand` if docs tests exist. If not, run: `pnpm --dir apps/docs build`.

Expected: PASS. If the docs app needs unavailable env vars, skip the build and note it in the final implementation summary.

- [ ] **Step 3: Commit**

```bash
git add apps/docs/content/docs/guide/admin-guide/billing.mdx
git commit -m "docs: update billing suspension behavior"
```

## Task 12: Final Verification

**Files:**
- Verify changed files only.

- [ ] **Step 1: Run focused webapp tests**

Run:

```bash
pnpm --dir apps/webapp test src/db/schema/__tests__/billing-schema.test.ts src/lib/effect/services/billing/billing-access.test.ts src/lib/effect/services/billing/billing-enforcement.service.test.ts src/lib/effect/services/billing/subscription.service.test.ts src/lib/effect/services/billing/stripe.service.test.ts src/lib/billing/guard.test.ts src/components/billing/trial-banner.test.tsx src/components/billing/billing-page-client.test.tsx 'src/app/[locale]/(app)/billing/suspended/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 2: Run broader checks**

Run:

```bash
pnpm --dir apps/webapp test src/lib/effect/services/billing src/components/billing 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: PASS.

- [ ] **Step 3: Run lint/type/build if available**

Run:

```bash
pnpm --dir apps/webapp lint
```

Expected: PASS or the repo reports no lint script. Then run:

```bash
CI=true pnpm build
```

Expected: PASS. If build requires Phase-managed system env vars that agents cannot access, skip and record the exact missing variables in the final summary.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only intended billing enforcement, docs, tests, schema, and migration files are changed.

- [ ] **Step 5: Final commit if needed**

If any verification fixes were made:

```bash
git add apps/webapp apps/docs
git commit -m "fix: verify billing suspension enforcement"
```

## Self-Review

- Spec coverage: the plan covers schema nullable Stripe customer IDs, local trials, existing-org lazy trials, central access state, page blocking, trial banner, localized UI strings, Checkout remaining trial days, mutation guard, webhook cancellation semantics, docs, and verification.
- Placeholder scan: no `TBD`, `TODO`, or intentionally vague implementation steps remain. The only conditional steps are explicit skip/commit branches for files or scripts that may not exist.
- Type consistency: `BillingAccessResult`, `BillingSuspensionReason`, `evaluateBillingAccess`, `getDaysRemaining`, `TrialBanner`, `requireBillingForMutation`, `isBillingMutationAllowed`, and `createBillingForbiddenResponse` are introduced before later tasks use them.
