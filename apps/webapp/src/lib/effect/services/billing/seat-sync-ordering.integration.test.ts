/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Seat quantities reach Stripe in order, and ambiguous sends are reconciled.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { deliverOrganizationSeats, type SeatStripePort } from "./seat-delivery";

describe("ordered seat delivery", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function organizationWithSeats(seats: number, stripeSubscriptionId: string | null) {
		const organizationId = await fixture.createOrganization();
		const employees: SeededEmployee[] = [];
		for (let index = 0; index < seats; index += 1) {
			employees.push(await fixture.seedEmployee({ organizationId }));
		}
		await fixture.pool.query(
			`insert into subscription (organization_id, status, stripe_subscription_id, current_seats)
			 values ($1, 'active', $2, 0)`,
			[organizationId, stripeSubscriptionId],
		);
		return { organizationId, employees };
	}

	function stripeStub(initialQuantity: number) {
		const state = { quantity: initialQuantity, sent: [] as number[], keys: [] as string[] };
		let gate: Promise<void> | null = null;
		let releaseGate = () => {};
		let failNext: "after_apply" | null = null;
		const port: SeatStripePort = {
			async getQuantity() {
				return { itemId: "si_1", quantity: state.quantity };
			},
			async setQuantity(input) {
				state.sent.push(input.quantity);
				state.keys.push(input.idempotencyKey);
				if (gate) await gate;
				state.quantity = input.quantity;
				if (failNext === "after_apply") {
					failNext = null;
					throw new Error("Request timed out");
				}
			},
		};
		return {
			port,
			state,
			holdNextSend() {
				gate = new Promise<void>((resolve) => {
					releaseGate = () => {
						gate = null;
						resolve();
					};
				});
			},
			release: () => releaseGate(),
			timeOutAfterApplying() {
				failNext = "after_apply";
			},
		};
	}

	async function waitForLockWaiter() {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const waiting = await fixture.pool.query<{ count: number }>(
				`select count(*)::int as count from pg_stat_activity
				 where datname = current_database() and wait_event_type = 'Lock'`,
			);
			if ((waiting.rows[0]?.count ?? 0) > 0) return;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error("expected a delivery waiting on the organization lock");
	}

	const localSeats = async (organizationId: string) =>
		(
			await fixture.pool.query<{ current_seats: number }>(
				`select current_seats from subscription where organization_id = $1`,
				[organizationId],
			)
		).rows[0]?.current_seats;

	it("never lets a delayed earlier delivery leave Stripe at an older count", async () => {
		const { organizationId, employees } = await organizationWithSeats(3, "sub_ordered");
		const stripe = stripeStub(0);
		const deliver = () =>
			deliverOrganizationSeats({ pool: fixture.pool, organizationId, stripe: stripe.port });

		stripe.holdNextSend();
		const first = deliver();
		while (stripe.state.sent.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
		await fixture.pool.query(`delete from member where id = $1`, [employees[2]?.memberId]);
		const second = deliver();
		await waitForLockWaiter();
		expect(stripe.state.sent).toEqual([3]);
		stripe.release();

		await expect(first).resolves.toMatchObject({ seats: 3, external: "confirmed" });
		await expect(second).resolves.toMatchObject({ seats: 2, external: "confirmed" });
		expect(stripe.state.sent).toEqual([3, 2]);
		expect(stripe.state.quantity).toBe(2);
		expect(new Set(stripe.state.keys).size).toBe(2);
		expect(await localSeats(organizationId)).toBe(2);
		const delivery = await fixture.pool.query(
			`select generation::int as generation, desired_quantity, reported_quantity, status
			 from billing_seat_delivery where organization_id = $1`,
			[organizationId],
		);
		expect(delivery.rows[0]).toEqual({
			generation: 2,
			desired_quantity: 2,
			reported_quantity: 2,
			status: "confirmed",
		});
	});

	it("reconciles an ambiguous send against Stripe before claiming success", async () => {
		const { organizationId } = await organizationWithSeats(2, "sub_ambiguous");
		const stripe = stripeStub(0);
		stripe.timeOutAfterApplying();

		await expect(
			deliverOrganizationSeats({ pool: fixture.pool, organizationId, stripe: stripe.port }),
		).rejects.toThrow("uncertain");
		const uncertain = await fixture.pool.query(
			`select status from billing_seat_delivery where organization_id = $1`,
			[organizationId],
		);
		expect(uncertain.rows[0]).toEqual({ status: "uncertain" });

		await expect(
			deliverOrganizationSeats({ pool: fixture.pool, organizationId, stripe: stripe.port }),
		).resolves.toMatchObject({ seats: 2, external: "confirmed" });
		// Stripe already applied the quantity; reconciliation must not send it again.
		expect(stripe.state.sent).toEqual([2]);
	});

	it("updates the local count without Stripe when billing is disabled", async () => {
		const { organizationId } = await organizationWithSeats(2, "sub_disabled");

		await expect(
			deliverOrganizationSeats({ pool: fixture.pool, organizationId, stripe: null }),
		).resolves.toEqual({ seats: 2, local: "updated", external: "skipped_disabled" });
		expect(await localSeats(organizationId)).toBe(2);
		const delivery = await fixture.pool.query(
			`select count(*)::int as count from billing_seat_delivery where organization_id = $1`,
			[organizationId],
		);
		expect(delivery.rows[0]).toEqual({ count: 0 });
	});

	describe("kiosk seats (#886)", () => {
		const KIOSK_PRICE = "price_kiosk_month";

		async function organizationWithStaff(input: {
			ordinary: number;
			kioskOnly: number;
			stripeSubscriptionId: string;
		}) {
			const { organizationId, employees } = await organizationWithSeats(
				input.ordinary + input.kioskOnly,
				input.stripeSubscriptionId,
			);
			const kioskOnly = employees.slice(input.ordinary);
			for (const employee of kioskOnly) {
				await fixture.pool.query(`update "user" set email = $2 where id = $1`, [
					employee.userId,
					`kiosk-${employee.userId.replaceAll("-", "")}@kiosk.invalid`,
				]);
			}
			return { organizationId, kioskOnly };
		}

		/** A Stripe subscription with a full seat item and, once added, a kiosk seat item. */
		function twoItemStripe(initial: { full: number; kiosk: number | null }) {
			const state = {
				full: initial.full,
				kiosk: initial.kiosk,
				sent: [] as { full: number; kiosk?: { itemId: string | null; quantity: number } }[],
				keys: [] as string[],
			};
			let failNext: "after_apply" | null = null;
			const port: SeatStripePort = {
				async getQuantity() {
					return {
						itemId: "si_full",
						quantity: state.full,
						kiosk: {
							itemId: state.kiosk === null ? null : "si_kiosk",
							quantity: state.kiosk ?? 0,
							priceId: KIOSK_PRICE,
						},
					};
				},
				async setQuantity(input) {
					state.sent.push({
						full: input.quantity,
						...(input.kiosk
							? { kiosk: { itemId: input.kiosk.itemId, quantity: input.kiosk.quantity } }
							: {}),
					});
					state.keys.push(input.idempotencyKey);
					state.full = input.quantity;
					if (input.kiosk) {
						expect(input.kiosk.priceId).toBe(KIOSK_PRICE);
						state.kiosk = input.kiosk.quantity;
					}
					if (failNext === "after_apply") {
						failNext = null;
						throw new Error("Request timed out");
					}
				},
			};
			return {
				port,
				state,
				timeOutAfterApplying() {
					failNext = "after_apply";
				},
			};
		}

		const localSplit = async (organizationId: string) =>
			(
				await fixture.pool.query<{ current_seats: number; current_kiosk_seats: number }>(
					`select current_seats, current_kiosk_seats from subscription where organization_id = $1`,
					[organizationId],
				)
			).rows[0];

		const deliveryRow = async (organizationId: string) =>
			(
				await fixture.pool.query(
					`select generation::int as generation, desired_quantity, reported_quantity,
					        desired_kiosk_quantity, reported_kiosk_quantity, status
					 from billing_seat_delivery where organization_id = $1`,
					[organizationId],
				)
			).rows[0];

		it("brings full and kiosk seats to Stripe together, adding the kiosk item the first time", async () => {
			const { organizationId } = await organizationWithStaff({
				ordinary: 3,
				kioskOnly: 5,
				stripeSubscriptionId: "sub_kiosk_split",
			});
			// Today's subscription bills all eight as full seats and has no kiosk item yet.
			const stripe = twoItemStripe({ full: 8, kiosk: null });
			const deliver = () =>
				deliverOrganizationSeats({
					pool: fixture.pool,
					organizationId,
					stripe: stripe.port,
					kioskSeats: true,
				});

			await expect(deliver()).resolves.toMatchObject({
				seats: 8,
				kioskSeats: 5,
				external: "confirmed",
			});
			expect(stripe.state.sent).toEqual([{ full: 3, kiosk: { itemId: null, quantity: 5 } }]);
			expect(stripe.state.keys).toEqual([`seat-sync:${organizationId}:1`]);
			expect(await localSplit(organizationId)).toEqual({
				current_seats: 8,
				current_kiosk_seats: 5,
			});
			expect(await deliveryRow(organizationId)).toEqual({
				generation: 1,
				desired_quantity: 3,
				reported_quantity: 3,
				desired_kiosk_quantity: 5,
				reported_kiosk_quantity: 5,
				status: "confirmed",
			});

			// Already split: nothing more to send.
			await expect(deliver()).resolves.toMatchObject({ seats: 8, external: "unchanged" });
			expect(stripe.state.sent).toHaveLength(1);
		});

		it("moves a seat between the quantities on the existing kiosk item", async () => {
			const { organizationId, kioskOnly } = await organizationWithStaff({
				ordinary: 1,
				kioskOnly: 2,
				stripeSubscriptionId: "sub_kiosk_move",
			});
			const stripe = twoItemStripe({ full: 1, kiosk: 2 });
			await fixture.pool.query(`update "user" set email = $2 where id = $1`, [
				kioskOnly[0]?.userId,
				`${kioskOnly[0]?.userId}@lifecycle.test`,
			]);

			await expect(
				deliverOrganizationSeats({
					pool: fixture.pool,
					organizationId,
					stripe: stripe.port,
					kioskSeats: true,
				}),
			).resolves.toMatchObject({ seats: 3, kioskSeats: 1, external: "confirmed" });
			expect(stripe.state.sent).toEqual([{ full: 2, kiosk: { itemId: "si_kiosk", quantity: 1 } }]);
		});

		it("adds no kiosk item while the organization has no kiosk seats", async () => {
			const { organizationId } = await organizationWithStaff({
				ordinary: 2,
				kioskOnly: 0,
				stripeSubscriptionId: "sub_kiosk_none",
			});
			const stripe = twoItemStripe({ full: 1, kiosk: null });

			await deliverOrganizationSeats({
				pool: fixture.pool,
				organizationId,
				stripe: stripe.port,
				kioskSeats: true,
			});

			expect(stripe.state.sent).toEqual([{ full: 2 }]);
			expect(stripe.state.kiosk).toBeNull();
		});

		it("reconciles both quantities after an uncertain send", async () => {
			const { organizationId } = await organizationWithStaff({
				ordinary: 2,
				kioskOnly: 3,
				stripeSubscriptionId: "sub_kiosk_uncertain",
			});
			const stripe = twoItemStripe({ full: 5, kiosk: null });
			stripe.timeOutAfterApplying();
			const deliver = () =>
				deliverOrganizationSeats({
					pool: fixture.pool,
					organizationId,
					stripe: stripe.port,
					kioskSeats: true,
				});

			await expect(deliver()).rejects.toThrow("uncertain");
			expect(await deliveryRow(organizationId)).toMatchObject({
				desired_quantity: 2,
				desired_kiosk_quantity: 3,
				status: "uncertain",
			});

			await expect(deliver()).resolves.toMatchObject({
				seats: 5,
				kioskSeats: 3,
				external: "confirmed",
			});
			// Stripe already applied both quantities; reconciliation must not send them again.
			expect(stripe.state.sent).toHaveLength(1);
			expect(await deliveryRow(organizationId)).toMatchObject({
				reported_quantity: 2,
				reported_kiosk_quantity: 3,
				status: "confirmed",
			});
		});

		it("bills kiosk-only employees as full seats while kiosk seats are off", async () => {
			const { organizationId } = await organizationWithStaff({
				ordinary: 1,
				kioskOnly: 2,
				stripeSubscriptionId: "sub_kiosk_off",
			});
			const stripe = stripeStub(0);

			await expect(
				deliverOrganizationSeats({ pool: fixture.pool, organizationId, stripe: stripe.port }),
			).resolves.toEqual({ seats: 3, local: "updated", external: "confirmed" });
			expect(stripe.state.sent).toEqual([3]);
			expect(await localSplit(organizationId)).toEqual({
				current_seats: 3,
				current_kiosk_seats: 0,
			});
		});
	});
});
