/**
 * #317 / T52 runtime evidence: billing access around the manual work transaction.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real public `createManualTimeEntry` server action runs with the real billing
 * guard (trial provisioning before the transaction) and the real in-transaction
 * billing revalidation. Billing changes go through the real mutation owners: the
 * Stripe webhook event processor, the subscription service and trial
 * provisioning. Only the request/session, the Stripe API client, seat sync,
 * billing email, notification delivery and Next cache boundaries are replaced;
 * nothing talks to Stripe.
 */

import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { Pool, type PoolClient } from "pg";
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import("@/db/postgres-utc");
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString:
				process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ??
				"postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 12,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: { activeOrganizationId: harness.organizationId },
						}
					: null,
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	return {
		...original,
		getPrincipalContext: async () =>
			harness.userId && harness.organizationId
				? loadOrganizationPrincipalContext(db, {
						userId: harness.userId,
						organizationId: harness.organizationId,
					})
				: null,
	};
});

vi.mock("@/lib/billing/billing-system-email", () => ({
	sendBillingSystemEmail: async () => undefined,
}));

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" ? async () => undefined : value,
		]),
	);
});

vi.mock("./approvals", async (importOriginal) => ({
	...(await importOriginal<typeof import("./approvals")>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

vi.mock("./shared", async (importOriginal) => {
	const original = await importOriginal<typeof import("./shared")>();
	return {
		...original,
		logger: {
			...original.logger,
			error: () => {},
			warn: () => {},
			info: () => {},
			debug: () => {},
		},
	};
});

const { env } = await import("@/env");
const { createManualTimeEntry } = await import("../actions");
const { BillingEventsService, BillingEventsServiceLive } = await import(
	"@/lib/effect/services/billing/billing-events.service"
);
const { SubscriptionServiceLive } = await import(
	"@/lib/effect/services/billing/subscription.service"
);
const { SubscriptionService } = await import("@/lib/effect/services/billing/subscription.service");
const { requireBillingForMutation } = await import("@/lib/billing/guard");
const { StripeService } = await import("@/lib/effect/services/billing/stripe.service");
const { SeatSyncService } = await import("@/lib/effect/services/billing/seat-sync.service");

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required: integrationRequired,
	sentinel: testSentinel,
});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`manual billing PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t317-billing-org",
	employeeUser: "t317-employee-user",
	employee: "e3170000-0000-4000-8000-000000000001",
	stripeSubscription: "sub_t317",
	stripeCustomer: "cus_t317",
} as const;

/** Stripe objects carry only what the event owners read. */
function stripeEvent(type: string, object: Record<string, unknown>): Stripe.Event {
	return {
		id: `evt_t317_${randomUUID()}`,
		type,
		data: { object: { metadata: { organizationId: ids.organization }, ...object } },
	} as unknown as Stripe.Event;
}

const stripeSubscription = (status: string) => ({
	id: ids.stripeSubscription,
	object: "subscription",
	customer: ids.stripeCustomer,
	status,
	cancel_at: null,
	canceled_at: null,
	trial_end: null,
	pause_collection: null,
	items: {
		data: [
			{
				quantity: 1,
				current_period_start: 1_788_000_000,
				current_period_end: 1_790_600_000,
				price: { id: "price_t317", recurring: { interval: "month" } },
			},
		],
	},
});

const billingEventsLayer = BillingEventsServiceLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			SubscriptionServiceLive,
			Layer.succeed(
				StripeService,
				StripeService.of({
					getCustomer: () => Effect.succeed({ email: null }),
					getSubscription: () => Effect.succeed(stripeSubscription("active")),
				} as never),
			),
			Layer.succeed(
				SeatSyncService,
				SeatSyncService.of({ syncSeatsForOrganization: () => Effect.void } as never),
			),
		),
	),
);

/** The production webhook entry point for one event. */
function processStripeEvent(event: Stripe.Event) {
	return Effect.runPromise(
		Effect.gen(function* () {
			const events = yield* BillingEventsService;
			yield* events.processEvent(event);
		}).pipe(Effect.provide(billingEventsLayer)),
	);
}

function runSubscriptionService<A, E>(
	use: (service: typeof SubscriptionService.Service) => Effect.Effect<A, E>,
) {
	return Effect.runPromise(
		Effect.flatMap(SubscriptionService, use).pipe(Effect.provide(SubscriptionServiceLive)),
	);
}

function manualCommand(overrides: Partial<ManualTimeEntryCommand> = {}): ManualTimeEntryCommand {
	return {
		version: 2,
		submissionId: randomUUID(),
		targetEmployeeId: ids.employee,
		date: "2026-09-01",
		clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 120 },
		clockOut: { time: "12:30", occurrence: null, displayedOffsetMinutes: 120 },
		zone: { basis: "target", timezone: "Europe/Berlin" },
		browserTimezone: "Europe/Berlin",
		reason: "Forgot to clock in",
		projectId: null,
		workCategoryId: null,
		...overrides,
	};
}

describeIntegration("manual command billing revalidation on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 8 });
	const configurationKey = JSON.stringify(["work-organization-configuration", ids.organization]);
	const previousBillingEnabled = env.BILLING_ENABLED;

	function submit(command: ManualTimeEntryCommand) {
		harness.userId = ids.employeeUser;
		harness.organizationId = ids.organization;
		return createManualTimeEntry(command);
	}

	async function subscriptionRow() {
		const { rows } = await admin.query<{ status: string; trial_end: Date | null }>(
			"select status, trial_end from subscription where organization_id = $1",
			[ids.organization],
		);
		return rows[0] ?? null;
	}

	async function setSubscription(status: string | null) {
		await admin.query("delete from subscription where organization_id = $1", [ids.organization]);
		if (status) {
			await admin.query(
				`insert into subscription
				 (organization_id, stripe_customer_id, stripe_subscription_id, status, current_seats)
				 values ($1, $2, $3, $4, 1)`,
				[ids.organization, ids.stripeCustomer, ids.stripeSubscription, status],
			);
		}
	}

	/** Every row a manual submission can write, to prove "no writes" by equality. */
	async function workSnapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return rows[0];
	}

	const held = new Set<PoolClient>();

	async function inTransaction(statement: string, values: unknown[]) {
		const client: PoolClient = await admin.connect();
		held.add(client);
		await client.query("begin");
		await client.query(statement, values);
		return {
			async release() {
				held.delete(client);
				await client.query("commit");
				client.release();
			},
		};
	}

	/** A failed test must not leave locks that block the next seed. */
	async function releaseHeld() {
		for (const client of held) {
			held.delete(client);
			await client.query("rollback").catch(() => undefined);
			client.release();
		}
	}

	/** Blocks the subscription row the way a slow in-flight writer would. */
	const holdSubscriptionRow = () =>
		inTransaction("select 1 from subscription where organization_id = $1 for update", [
			ids.organization,
		]);

	/** Shared: an in-flight work transaction. Exclusive: a configuration writer. */
	const holdConfiguration = (mode: "shared" | "exclusive") =>
		inTransaction(
			mode === "shared"
				? "select pg_advisory_xact_lock_shared(hashtextextended($1, 0))"
				: "select pg_advisory_xact_lock(hashtextextended($1, 0))",
			[configurationKey],
		);

	async function waitForLockWaiters(count: number, locktype?: "advisory") {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const { rows } = await admin.query<{ count: number }>(
				`select count(*)::int as count from pg_locks
				 where not granted and ($1::text is null or locktype = $1)`,
				[locktype ?? null],
			);
			if ((rows[0]?.count ?? 0) >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error(`Expected ${count} lock waiter(s)`);
	}

	async function cleanup() {
		await releaseHeld();
		await admin.query("drop function if exists t317_fail() cascade");
		await admin.query("delete from stripe_event where stripe_event_id like 'evt_t317_%'");
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = $1', [ids.employeeUser]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T317 billing', $1, 'Europe/Berlin', $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, $1, $1 || '@example.test', $2, $2)`,
			[ids.employeeUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t317-m-employee', $1, $2, 'member', 'approved', $3)`,
			[ids.organization, ids.employeeUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $2, $3, 'employee', $4)`,
			[ids.employee, ids.employeeUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at) values ($1, 'Europe/Berlin', $2)`,
			[ids.employeeUser, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'manual_time_submission', 'legacy', 'legacy', now(), now())`,
			[ids.organization],
		);
		await admin.query(
			"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
		await setSubscription("active");
	}

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await admin.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") {
			throw new Error("Manual billing PostgreSQL is disabled");
		}
		(env as { BILLING_ENABLED: "true" | "false" }).BILLING_ENABLED = "true";
	});

	beforeEach(async () => {
		await seed();
	});

	afterAll(async () => {
		(env as { BILLING_ENABLED: "true" | "false" }).BILLING_ENABLED = previousBillingEnabled;
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	describe("concurrent billing changes", () => {
		it("rejects a submission that a concurrent payment failure committed ahead of", async () => {
			const before = await workSnapshot();
			const row = await holdSubscriptionRow();
			// The webhook owner takes exclusive protection, then waits on the row.
			const webhook = processStripeEvent(
				stripeEvent("invoice.payment_failed", {
					id: "in_t317",
					subscription: ids.stripeSubscription,
				}),
			);
			await waitForLockWaiters(1);
			// The public guard still sees an active subscription; the transaction waits.
			const pending = submit(manualCommand());
			await waitForLockWaiters(1, "advisory");
			expect(await subscriptionRow()).toMatchObject({ status: "active" });
			await row.release();
			await webhook;

			await expect(pending).resolves.toEqual({
				success: false,
				error: "billing_required",
				code: "payment_failed",
			});
			expect(await subscriptionRow()).toMatchObject({ status: "past_due" });
			expect(await workSnapshot()).toEqual(before);
		});

		it("gates exact replay on current billing and replays unchanged once access returns", async () => {
			const command = manualCommand();
			const committed = await submit(command);
			expect(committed).toMatchObject({ success: true, data: { disposition: "executed" } });
			const afterCommit = await workSnapshot();

			const row = await holdSubscriptionRow();
			const webhook = processStripeEvent(
				stripeEvent("invoice.payment_failed", {
					id: "in_t317",
					subscription: ids.stripeSubscription,
				}),
			);
			await waitForLockWaiters(1);
			const replay = submit(structuredClone(command));
			await waitForLockWaiters(1, "advisory");
			await row.release();
			await webhook;
			await expect(replay).resolves.toEqual({
				success: false,
				error: "billing_required",
				code: "payment_failed",
			});

			await processStripeEvent(
				stripeEvent("invoice.payment_succeeded", {
					id: "in_t317_paid",
					subscription: ids.stripeSubscription,
				}),
			);
			await expect(submit(structuredClone(command))).resolves.toEqual(
				committed.success
					? { ...committed, data: { ...committed.data, disposition: "replayed" } }
					: committed,
			);
			expect(await workSnapshot()).toEqual(afterCommit);
		});

		it("lets a waiting submission commit under unchanged billing when the billing writer rolls back", async () => {
			await admin.query(`create function t317_fail() returns trigger language plpgsql as $$
				begin raise exception 't317 billing write failed'; end $$`);
			await admin.query(
				"create trigger t317_fail before update on subscription for each row execute function t317_fail()",
			);
			const row = await holdSubscriptionRow();
			const webhook = processStripeEvent(
				stripeEvent("invoice.payment_failed", {
					id: "in_t317",
					subscription: ids.stripeSubscription,
				}),
			);
			await waitForLockWaiters(1);
			const pending = submit(manualCommand());
			await waitForLockWaiters(1, "advisory");
			await row.release();

			await expect(webhook).rejects.toThrow();
			await expect(pending).resolves.toMatchObject({ success: true });
			expect(await subscriptionRow()).toMatchObject({ status: "active" });
		});
	});

	describe("trial provisioning", () => {
		it("never provisions inside the work transaction", async () => {
			const writer = await holdConfiguration("exclusive");
			const pending = submit(manualCommand());
			await waitForLockWaiters(1, "advisory");
			// The public guard already passed; the subscription disappears before the protected read.
			await admin.query("delete from subscription where organization_id = $1", [ids.organization]);
			await writer.release();

			await expect(pending).resolves.toEqual({
				success: false,
				error: "billing_required",
				code: "subscription_required",
			});
			expect(await subscriptionRow()).toBeNull();
		});

		it("provisions a missing trial before the transaction, after in-flight work transactions", async () => {
			await setSubscription(null);
			const work = await holdConfiguration("shared");
			const pending = submit(manualCommand());
			await waitForLockWaiters(1, "advisory");
			expect(await subscriptionRow()).toBeNull();
			await work.release();

			await expect(pending).resolves.toMatchObject({ success: true });
			const trial = await subscriptionRow();
			expect(trial).toMatchObject({ status: "trialing" });
			expect(trial?.trial_end?.getTime()).toBeGreaterThan(Date.now());
		});

		it("reads an existing subscription without configuration protection", async () => {
			const work = await holdConfiguration("shared");
			try {
				await expect(requireBillingForMutation(ids.organization)).resolves.toMatchObject({
					canAccess: true,
					state: "active",
				});
			} finally {
				await work.release();
			}
		});
	});

	describe("billing mutation owners", () => {
		const subscriptionOwners: {
			name: string;
			initial: string | null;
			expected: string;
			run: () => Promise<unknown>;
		}[] = [
			{
				name: "invoice.payment_failed",
				initial: "active",
				expected: "past_due",
				run: () =>
					processStripeEvent(
						stripeEvent("invoice.payment_failed", {
							id: "in_t317",
							subscription: ids.stripeSubscription,
						}),
					),
			},
			{
				name: "invoice.payment_succeeded",
				initial: "past_due",
				expected: "active",
				run: () =>
					processStripeEvent(
						stripeEvent("invoice.payment_succeeded", {
							id: "in_t317",
							subscription: ids.stripeSubscription,
						}),
					),
			},
			{
				name: "customer.subscription.updated",
				initial: "active",
				expected: "unpaid",
				run: () =>
					processStripeEvent(
						stripeEvent("customer.subscription.updated", stripeSubscription("unpaid")),
					),
			},
			{
				name: "customer.subscription.deleted",
				initial: "active",
				expected: "canceled",
				run: () =>
					processStripeEvent(
						stripeEvent("customer.subscription.deleted", stripeSubscription("canceled")),
					),
			},
			{
				name: "customer.subscription.paused",
				initial: "active",
				expected: "paused",
				run: () =>
					processStripeEvent(
						stripeEvent("customer.subscription.paused", stripeSubscription("paused")),
					),
			},
			{
				name: "customer.subscription.resumed",
				initial: "paused",
				expected: "active",
				run: () =>
					processStripeEvent(
						stripeEvent("customer.subscription.resumed", stripeSubscription("active")),
					),
			},
			{
				name: "checkout.session.completed",
				initial: "incomplete",
				expected: "active",
				run: () =>
					processStripeEvent(
						stripeEvent("checkout.session.completed", {
							id: "cs_t317",
							subscription: ids.stripeSubscription,
							customer: ids.stripeCustomer,
						}),
					),
			},
			{
				name: "setStripeCustomerId (no subscription yet)",
				initial: null,
				expected: "incomplete",
				run: () =>
					runSubscriptionService((service) =>
						service.setStripeCustomerId(ids.organization, ids.stripeCustomer),
					),
			},
			{
				name: "ensureLocalTrial",
				initial: null,
				expected: "trialing",
				run: () =>
					runSubscriptionService((service) =>
						service.ensureLocalTrial({ organizationId: ids.organization }),
					),
			},
		];

		it.each(subscriptionOwners)(
			"$name waits for in-flight work transactions before changing billing",
			async ({ initial, expected, run }) => {
				await setSubscription(initial);
				const work = await holdConfiguration("shared");
				const mutation = run();
				await waitForLockWaiters(1, "advisory");
				expect((await subscriptionRow())?.status ?? null).toBe(initial);
				await work.release();

				await mutation;
				expect(await subscriptionRow()).toMatchObject({ status: expected });
			},
		);

		it("leaves access-unrelated events unprotected", async () => {
			const work = await holdConfiguration("shared");
			try {
				await processStripeEvent(
					stripeEvent("invoice.finalized", {
						id: "in_t317_final",
						number: "T317-1",
						subscription: ids.stripeSubscription,
						customer: ids.stripeCustomer,
						amount_due: 1000,
						amount_paid: 0,
						currency: "eur",
						status: "open",
					}),
				);
			} finally {
				await work.release();
			}
			const { rows } = await admin.query(
				"select metadata->'lastInvoice'->>'number' as number from subscription where organization_id = $1",
				[ids.organization],
			);
			expect(rows[0]).toEqual({ number: "T317-1" });
		});
	});
});
