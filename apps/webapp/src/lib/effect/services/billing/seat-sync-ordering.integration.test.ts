/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Seat quantities reach Stripe in order, and ambiguous sends are reconciled.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { deliverOrganizationSeats, type SeatStripePort } from "./seat-delivery";

describeLifecycleDatabase("ordered seat delivery", () => {
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
});
