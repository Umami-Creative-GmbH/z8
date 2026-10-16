/**
 * #1283 (spec #886): the one-time reconcile that moves existing subscriptions
 * to kiosk seats, on PostgreSQL. The real seat sync and seat delivery run
 * against the database; only the Stripe API is a fake holding, per
 * subscription, a full seat item and, once added, a kiosk seat item.
 */
import { Effect, Layer } from "effect";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateReservedEmail } from "@/lib/auth/reserved-email";
import { KioskSeatsNotConfiguredError, StripeError } from "@/lib/effect/errors";
import { SeatSyncServiceLive } from "@/lib/effect/services/billing/seat-sync.service";
import { type StripeConfig, StripeService } from "@/lib/effect/services/billing/stripe.service";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { reconcileKioskSeats } from "./kiosk-seat-reconcile";

const PRICES = {
	priceMonthlyId: "price_full_month",
	priceYearlyId: "price_full_year",
	priceKioskMonthlyId: "price_kiosk_month",
	priceKioskYearlyId: "price_kiosk_year",
};

type StripeSubscriptionState = { full: number; kiosk: number | null; broken?: boolean };

type FakeStripe = {
	subscriptions: Map<string, StripeSubscriptionState>;
	calls: { method: "getSubscription" | "updateSubscription"; subscriptionId: string }[];
	updates: { subscriptionId: string; params: Stripe.SubscriptionUpdateParams }[];
};

function fakeStripeLayer(stripe: FakeStripe, config: Partial<StripeConfig> = PRICES) {
	const view = (subscriptionId: string) => {
		const state = stripe.subscriptions.get(subscriptionId);
		if (!state) throw new Error(`unknown subscription ${subscriptionId}`);
		return {
			id: subscriptionId,
			items: {
				data: [
					{
						id: `si_full_${subscriptionId}`,
						quantity: state.full,
						price: { id: PRICES.priceMonthlyId },
					},
					...(state.kiosk === null
						? []
						: [
								{
									id: `si_kiosk_${subscriptionId}`,
									quantity: state.kiosk,
									price: { id: PRICES.priceKioskMonthlyId },
								},
							]),
				],
			},
		};
	};
	return Layer.succeed(
		StripeService,
		StripeService.of({
			config: { secretKey: "sk_test", webhookSecret: "", enabled: true, ...config },
			getSubscription: (subscriptionId: string) => {
				stripe.calls.push({ method: "getSubscription", subscriptionId });
				if (stripe.subscriptions.get(subscriptionId)?.broken) {
					return Effect.fail(
						new StripeError({ message: "No such subscription", operation: "getSubscription" }),
					);
				}
				return Effect.succeed(view(subscriptionId));
			},
			updateSubscription: (subscriptionId: string, params: Stripe.SubscriptionUpdateParams) => {
				stripe.calls.push({ method: "updateSubscription", subscriptionId });
				stripe.updates.push({ subscriptionId, params });
				const state = stripe.subscriptions.get(subscriptionId) as StripeSubscriptionState;
				for (const item of params.items ?? []) {
					if (item.id === `si_full_${subscriptionId}`) state.full = item.quantity ?? state.full;
					else state.kiosk = item.quantity ?? 0;
				}
				return Effect.succeed(view(subscriptionId));
			},
		} as never),
	);
}

describe("reconcile existing subscriptions into kiosk seats", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function newStripe(): FakeStripe {
		return { subscriptions: new Map(), calls: [], updates: [] };
	}

	/** An organization whose Stripe subscription bills every employee as a full seat. */
	async function billedAllFull(
		stripe: FakeStripe,
		input: { ordinary: number; kioskOnly: number; broken?: boolean },
	) {
		const organizationId = await fixture.createOrganization();
		for (let index = 0; index < input.ordinary; index += 1) {
			await fixture.seedEmployee({ organizationId, role: index === 0 ? "owner" : "member" });
		}
		for (let index = 0; index < input.kioskOnly; index += 1) {
			const employee = await fixture.seedEmployee({ organizationId });
			await fixture.pool.query(`update "user" set email = $2 where id = $1`, [
				employee.userId,
				generateReservedEmail(),
			]);
		}
		const seats = input.ordinary + input.kioskOnly;
		const subscriptionId = `sub_${organizationId}`;
		await fixture.pool.query(
			`insert into subscription (organization_id, status, stripe_subscription_id, current_seats)
			 values ($1, 'active', $2, $3)`,
			[organizationId, subscriptionId, seats],
		);
		stripe.subscriptions.set(subscriptionId, { full: seats, kiosk: null, broken: input.broken });
		return { organizationId, subscriptionId };
	}

	function reconcile(
		stripe: FakeStripe,
		organizationIds: readonly string[],
		config: Partial<StripeConfig> = PRICES,
	) {
		return Effect.runPromise(
			reconcileKioskSeats({ organizationIds }).pipe(
				Effect.provide(SeatSyncServiceLive),
				Effect.provide(fakeStripeLayer(stripe, config)),
				Effect.provide(DatabaseServiceLive),
			),
		);
	}

	const localSeats = async (organizationId: string) =>
		(
			await fixture.pool.query(
				`select current_seats, current_kiosk_seats from subscription where organization_id = $1`,
				[organizationId],
			)
		).rows[0];

	it("moves 3 ordinary and 2 kiosk-only employees billed as 5 full seats to 3 full and 2 kiosk seats", async () => {
		const stripe = newStripe();
		const { organizationId, subscriptionId } = await billedAllFull(stripe, {
			ordinary: 3,
			kioskOnly: 2,
		});

		const report = await reconcile(stripe, [organizationId]);

		expect(report).toEqual([{ organizationId, outcome: "updated", fullSeats: 3, kioskSeats: 2 }]);
		expect(stripe.updates).toEqual([
			{
				subscriptionId,
				params: {
					items: [
						{ id: `si_full_${subscriptionId}`, quantity: 3 },
						{ price: "price_kiosk_month", quantity: 2 },
					],
					proration_behavior: "create_prorations",
				},
			},
		]);
		expect(stripe.subscriptions.get(subscriptionId)).toMatchObject({ full: 3, kiosk: 2 });
		expect(await localSeats(organizationId)).toEqual({ current_seats: 5, current_kiosk_seats: 2 });
	});

	it("changes nothing when run a second time", async () => {
		const stripe = newStripe();
		const { organizationId } = await billedAllFull(stripe, { ordinary: 3, kioskOnly: 2 });
		await reconcile(stripe, [organizationId]);
		const updatesAfterFirstRun = stripe.updates.length;

		const report = await reconcile(stripe, [organizationId]);

		expect(report).toEqual([{ organizationId, outcome: "unchanged", fullSeats: 3, kioskSeats: 2 }]);
		expect(stripe.updates).toHaveLength(updatesAfterFirstRun);
	});

	const seatAudits = async (organizationId: string) =>
		(
			await fixture.pool.query(
				`select action, previous_seats, new_seats, previous_kiosk_seats, new_kiosk_seats, stripe_reported
				 from billing_seat_audit where organization_id = $1 order by created_at`,
				[organizationId],
			)
		).rows;

	it("records the new split in the seat audit, once, so seat history prices kiosk seats", async () => {
		const stripe = newStripe();
		const { organizationId } = await billedAllFull(stripe, { ordinary: 3, kioskOnly: 2 });
		await fixture.pool.query(
			`insert into billing_seat_audit (organization_id, action, previous_seats, new_seats, created_at)
			 values ($1, 'member_added', 4, 5, now() - interval '1 day')`,
			[organizationId],
		);

		await reconcile(stripe, [organizationId]);
		await reconcile(stripe, [organizationId]);

		expect(await seatAudits(organizationId)).toEqual([
			{
				action: "member_added",
				previous_seats: 4,
				new_seats: 5,
				previous_kiosk_seats: 0,
				new_kiosk_seats: 0,
				stripe_reported: false,
			},
			{
				action: "kiosk_seat_reconciled",
				previous_seats: 5,
				new_seats: 5,
				previous_kiosk_seats: 0,
				new_kiosk_seats: 2,
				stripe_reported: true,
			},
		]);
	});

	it("records the split even when seat sync already moved the subscription", async () => {
		const stripe = newStripe();
		const { organizationId, subscriptionId } = await billedAllFull(stripe, {
			ordinary: 1,
			kioskOnly: 1,
		});
		await fixture.pool.query(
			`insert into billing_seat_audit (organization_id, action, previous_seats, new_seats, created_at)
			 values ($1, 'member_added', 1, 2, now() - interval '1 day')`,
			[organizationId],
		);
		// The hourly seat reconciliation got there first.
		await fixture.pool.query(
			`update subscription set current_kiosk_seats = 1 where organization_id = $1`,
			[organizationId],
		);
		stripe.subscriptions.set(subscriptionId, { full: 1, kiosk: 1 });

		const report = await reconcile(stripe, [organizationId]);

		expect(report).toEqual([{ organizationId, outcome: "unchanged", fullSeats: 1, kioskSeats: 1 }]);
		expect((await seatAudits(organizationId)).at(-1)).toMatchObject({
			action: "kiosk_seat_reconciled",
			previous_seats: 2,
			new_seats: 2,
			previous_kiosk_seats: 0,
			new_kiosk_seats: 1,
		});
	});

	it("writes no seat audit for an organization without seat history", async () => {
		const stripe = newStripe();
		const { organizationId } = await billedAllFull(stripe, { ordinary: 1, kioskOnly: 1 });

		await reconcile(stripe, [organizationId]);

		expect(await seatAudits(organizationId)).toEqual([]);
	});

	it("refuses without any Stripe call while either kiosk price is unset", async () => {
		const stripe = newStripe();
		const { organizationId } = await billedAllFull(stripe, { ordinary: 3, kioskOnly: 2 });

		for (const config of [
			{ ...PRICES, priceKioskMonthlyId: "" },
			{ ...PRICES, priceKioskYearlyId: undefined },
			{ ...PRICES, enabled: false },
		]) {
			const refusal = reconcile(stripe, [organizationId], config);
			await expect(refusal).rejects.toBeInstanceOf(KioskSeatsNotConfiguredError);
			await expect(refusal).rejects.toThrow("Kiosk seats are not configured");
		}

		expect(stripe.calls).toEqual([]);
		expect(await localSeats(organizationId)).toEqual({ current_seats: 5, current_kiosk_seats: 0 });
	});

	it("reports one organization's failure and still moves the others", async () => {
		const stripe = newStripe();
		const first = await billedAllFull(stripe, { ordinary: 2, kioskOnly: 1 });
		const broken = await billedAllFull(stripe, { ordinary: 1, kioskOnly: 1, broken: true });
		const last = await billedAllFull(stripe, { ordinary: 1, kioskOnly: 3 });

		const report = await reconcile(stripe, [
			first.organizationId,
			broken.organizationId,
			last.organizationId,
		]);

		// Organizations run in id order, so the broken one may come first, between or last.
		expect(report).toHaveLength(3);
		expect(report).toEqual(
			expect.arrayContaining([
				{ organizationId: first.organizationId, outcome: "updated", fullSeats: 2, kioskSeats: 1 },
				{
					organizationId: broken.organizationId,
					outcome: "failed",
					error: expect.stringContaining("No such subscription"),
				},
				{ organizationId: last.organizationId, outcome: "updated", fullSeats: 1, kioskSeats: 3 },
			]),
		);
		expect(stripe.subscriptions.get(last.subscriptionId)).toMatchObject({ full: 1, kiosk: 3 });
	});

	it.each(["canceled", "incomplete_expired"])(
		"leaves out an organization whose Stripe subscription has ended (%s)",
		async (status) => {
			const stripe = newStripe();
			const live = await billedAllFull(stripe, { ordinary: 1, kioskOnly: 1 });
			const ended = await billedAllFull(stripe, { ordinary: 2, kioskOnly: 2 });
			await fixture.pool.query(`update subscription set status = $2 where organization_id = $1`, [
				ended.organizationId,
				status,
			]);

			const report = await reconcile(stripe, [live.organizationId, ended.organizationId]);

			expect(report).toEqual([
				{ organizationId: live.organizationId, outcome: "updated", fullSeats: 1, kioskSeats: 1 },
			]);
			expect(stripe.calls.filter((call) => call.subscriptionId === ended.subscriptionId)).toEqual(
				[],
			);
		},
	);

	it("covers every organization with a Stripe subscription, and only those", async () => {
		const stripe = newStripe();
		const subscribed = await billedAllFull(stripe, { ordinary: 1, kioskOnly: 1 });
		const localOnly = await fixture.createOrganization();
		await fixture.pool.query(
			`insert into subscription (organization_id, status, current_seats) values ($1, 'trialing', 1)`,
			[localOnly],
		);
		// Earlier cases' organizations stay subscribed; give the fake their state too.
		const earlier = await fixture.pool.query<{
			organization_id: string;
			stripe_subscription_id: string;
		}>(
			`select organization_id, stripe_subscription_id from subscription
			 where stripe_subscription_id is not null and organization_id <> $1`,
			[subscribed.organizationId],
		);
		for (const row of earlier.rows) {
			stripe.subscriptions.set(row.stripe_subscription_id, { full: 0, kiosk: null });
		}

		const report = await Effect.runPromise(
			reconcileKioskSeats().pipe(
				Effect.provide(SeatSyncServiceLive),
				Effect.provide(fakeStripeLayer(stripe)),
				Effect.provide(DatabaseServiceLive),
			),
		);

		const reported = report.map((entry) => entry.organizationId);
		expect(reported).toContain(subscribed.organizationId);
		expect(reported).not.toContain(localOnly);
		expect(reported).toEqual([...reported].sort());
		expect(report.find((entry) => entry.organizationId === subscribed.organizationId)).toEqual({
			organizationId: subscribed.organizationId,
			outcome: "updated",
			fullSeats: 1,
			kioskSeats: 1,
		});
	});
});
