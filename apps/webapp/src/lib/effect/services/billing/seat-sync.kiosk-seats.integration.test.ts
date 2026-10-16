/**
 * #1280 (spec #886): kiosk seats through the production seat sync on PostgreSQL.
 * The real SeatSyncService, subscription service and seat delivery run against
 * the database; only the Stripe API is a fake holding a full seat item and,
 * once added, a kiosk seat item.
 */
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { SeatSyncService, SeatSyncServiceLive } from "./seat-sync.service";
import { type StripeConfig, StripeService } from "./stripe.service";
import { SubscriptionServiceLive } from "./subscription.service";

const PRICES = {
	priceMonthlyId: "price_full_month",
	priceYearlyId: "price_full_year",
	priceKioskMonthlyId: "price_kiosk_month",
	priceKioskYearlyId: "price_kiosk_year",
};

type StripeState = {
	interval: "month" | "year";
	full: number;
	kiosk: number | null;
	updates: { params: Stripe.SubscriptionUpdateParams; idempotencyKey?: string }[];
};

function fakeStripe(state: StripeState, config: Partial<StripeConfig> = PRICES) {
	const subscription = () => ({
		id: "sub_kiosk",
		items: {
			data: [
				{
					id: "si_full",
					quantity: state.full,
					price: { id: state.interval === "year" ? PRICES.priceYearlyId : PRICES.priceMonthlyId },
				},
				...(state.kiosk === null
					? []
					: [
							{
								id: "si_kiosk",
								quantity: state.kiosk,
								price: {
									id:
										state.interval === "year"
											? PRICES.priceKioskYearlyId
											: PRICES.priceKioskMonthlyId,
								},
							},
						]),
			],
		},
	});
	return Layer.succeed(
		StripeService,
		StripeService.of({
			config: { secretKey: "", webhookSecret: "", enabled: true, ...config },
			getSubscription: () => Effect.succeed(subscription()),
			updateSubscription: (
				_id: string,
				params: Stripe.SubscriptionUpdateParams,
				options?: { idempotencyKey?: string },
			) => {
				state.updates.push({ params, idempotencyKey: options?.idempotencyKey });
				for (const item of params.items ?? []) {
					if (item.id === "si_full") state.full = item.quantity ?? state.full;
					else state.kiosk = item.quantity ?? 0;
				}
				return Effect.succeed(subscription());
			},
		} as never),
	);
}

describe("kiosk seats through seat sync", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function makeKioskOnly(target: SeededEmployee) {
		await fixture.pool.query(`update "user" set email = $2 where id = $1`, [
			target.userId,
			`kiosk-${randomUUID().replaceAll("-", "")}@kiosk.invalid`,
		]);
		return target;
	}

	async function subscribedOrganization(input: { ordinary: number; kioskOnly: number }) {
		const organizationId = await fixture.createOrganization();
		for (let index = 0; index < input.ordinary; index += 1) {
			await fixture.seedEmployee({ organizationId, role: index === 0 ? "owner" : "member" });
		}
		const kioskOnly: SeededEmployee[] = [];
		for (let index = 0; index < input.kioskOnly; index += 1) {
			kioskOnly.push(await makeKioskOnly(await fixture.seedEmployee({ organizationId })));
		}
		const seats = input.ordinary + input.kioskOnly;
		await fixture.pool.query(
			`insert into subscription (organization_id, status, stripe_subscription_id, current_seats)
			 values ($1, 'active', $2, $3)`,
			[organizationId, `sub_${organizationId}`, seats],
		);
		return { organizationId, kioskOnly };
	}

	function run<A, E>(
		stripe: Layer.Layer<StripeService>,
		use: (service: typeof SeatSyncService.Service) => Effect.Effect<A, E>,
	) {
		return Effect.runPromise(
			Effect.flatMap(SeatSyncService, use).pipe(
				Effect.provide(SeatSyncServiceLive),
				Effect.provide(Layer.mergeAll(stripe, SubscriptionServiceLive)),
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

	const audits = async (organizationId: string) =>
		(
			await fixture.pool.query(
				`select action, previous_seats, new_seats, previous_kiosk_seats, new_kiosk_seats, stripe_reported
				 from billing_seat_audit where organization_id = $1 order by created_at`,
				[organizationId],
			)
		).rows;

	it("reports 3 ordinary and 5 kiosk-only employees as 3 full and 5 kiosk seats", async () => {
		const { organizationId } = await subscribedOrganization({ ordinary: 3, kioskOnly: 5 });
		const state: StripeState = { interval: "month", full: 8, kiosk: null, updates: [] };

		await expect(
			run(fakeStripe(state), (service) => service.syncSeatsForOrganization(organizationId)),
		).resolves.toBe(8);

		expect(state.updates).toEqual([
			{
				params: {
					items: [
						{ id: "si_full", quantity: 3 },
						{ price: "price_kiosk_month", quantity: 5 },
					],
					proration_behavior: "create_prorations",
				},
				idempotencyKey: `seat-sync:${organizationId}:1`,
			},
		]);
		expect(state).toMatchObject({ full: 3, kiosk: 5 });
		expect(await localSeats(organizationId)).toEqual({ current_seats: 8, current_kiosk_seats: 5 });
	});

	it("bills a yearly subscription's kiosk seats at the yearly kiosk price", async () => {
		const { organizationId } = await subscribedOrganization({ ordinary: 1, kioskOnly: 2 });
		const state: StripeState = { interval: "year", full: 3, kiosk: null, updates: [] };

		await run(fakeStripe(state), (service) => service.syncSeatsForOrganization(organizationId));

		expect(state.updates[0]?.params.items).toEqual([
			{ id: "si_full", quantity: 1 },
			{ price: "price_kiosk_year", quantity: 2 },
		]);
	});

	it("raises the kiosk quantity when a kiosk-only employee is created and audits it", async () => {
		const { organizationId } = await subscribedOrganization({ ordinary: 2, kioskOnly: 1 });
		const state: StripeState = { interval: "month", full: 2, kiosk: 1, updates: [] };
		const stripe = fakeStripe(state);
		await run(stripe, (service) => service.syncSeatsForOrganization(organizationId));

		const created = await makeKioskOnly(await fixture.seedEmployee({ organizationId }));
		await run(stripe, (service) =>
			service.handleMemberAdded(organizationId, created.memberId, created.userId),
		);

		expect(state.updates.map((update) => update.params.items)).toEqual([
			[
				{ id: "si_full", quantity: 2 },
				{ id: "si_kiosk", quantity: 2 },
			],
		]);
		expect(await localSeats(organizationId)).toEqual({ current_seats: 4, current_kiosk_seats: 2 });
		expect(await audits(organizationId)).toEqual([
			{
				action: "member_added",
				previous_seats: 3,
				new_seats: 4,
				previous_kiosk_seats: 1,
				new_kiosk_seats: 2,
				stripe_reported: true,
			},
		]);
	});

	it("drops a departed kiosk-only employee from the kiosk quantity and audits it", async () => {
		const { organizationId, kioskOnly } = await subscribedOrganization({
			ordinary: 2,
			kioskOnly: 3,
		});
		const state: StripeState = { interval: "month", full: 2, kiosk: 3, updates: [] };
		const stripe = fakeStripe(state);
		await run(stripe, (service) => service.syncSeatsForOrganization(organizationId));
		const leaving = kioskOnly[0] as SeededEmployee;
		await fixture.pool.query(`update employee set is_active = false where id = $1`, [
			leaving.employeeId,
		]);
		await fixture.pool.query(`delete from member where id = $1`, [leaving.memberId]);

		await run(stripe, (service) =>
			service.handleMemberRemoved(organizationId, leaving.memberId, leaving.userId),
		);

		expect(state).toMatchObject({ full: 2, kiosk: 2 });
		expect(await audits(organizationId)).toEqual([
			{
				action: "member_removed",
				previous_seats: 5,
				new_seats: 4,
				previous_kiosk_seats: 3,
				new_kiosk_seats: 2,
				stripe_reported: true,
			},
		]);
	});

	it("bills every seat as a full seat while either kiosk price is unset", async () => {
		const { organizationId } = await subscribedOrganization({ ordinary: 3, kioskOnly: 5 });
		const state: StripeState = { interval: "month", full: 3, kiosk: null, updates: [] };

		await run(
			fakeStripe(state, { ...PRICES, priceKioskYearlyId: "" }),
			(service) => service.syncSeatsForOrganization(organizationId),
		);

		expect(state.updates).toEqual([
			{
				params: { items: [{ id: "si_full", quantity: 8 }], proration_behavior: "create_prorations" },
				idempotencyKey: `seat-sync:${organizationId}:1`,
			},
		]);
		expect(await localSeats(organizationId)).toEqual({ current_seats: 8, current_kiosk_seats: 0 });
	});
});
