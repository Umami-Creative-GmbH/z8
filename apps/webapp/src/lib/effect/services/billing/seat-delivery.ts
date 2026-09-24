import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import type { Instant } from "@/lib/datetime/temporal-core";
import { countBillableSeats } from "./billable-seat-count";

/** The Stripe operations seat delivery needs; the production adapter wraps StripeService. */
export type SeatStripePort = {
	getQuantity(subscriptionId: string): Promise<{ itemId: string; quantity: number }>;
	setQuantity(input: {
		subscriptionId: string;
		itemId: string;
		quantity: number;
		idempotencyKey: string;
	}): Promise<void>;
};

export type SeatDeliveryOutcome = {
	seats: number;
	local: "updated";
	external: "skipped_disabled" | "skipped_no_subscription" | "unchanged" | "confirmed";
};

export class SeatDeliveryUncertainError extends Error {
	constructor(
		readonly organizationId: string,
		readonly generation: number,
		cause: unknown,
	) {
		super(`Stripe seat delivery uncertain for generation ${generation}`, { cause });
		this.name = "SeatDeliveryUncertainError";
	}
}

const LOCK_NAMESPACE = "billing-seat-sync:";

/**
 * Serializes seat delivery per organization with a PostgreSQL session advisory
 * lock on a dedicated connection. No data transaction stays open across the
 * Stripe request. If unlocking fails the connection is destroyed, which
 * releases the session lock.
 */
async function withOrganizationSeatLock<T>(
	pool: Pool,
	organizationId: string,
	work: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	let destroy = false;
	try {
		await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
			`${LOCK_NAMESPACE}${organizationId}`,
		]);
		try {
			return await work(client);
		} finally {
			try {
				await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
					`${LOCK_NAMESPACE}${organizationId}`,
				]);
			} catch {
				destroy = true;
			}
		}
	} finally {
		client.release(destroy);
	}
}

type DeliveryRow = {
	generation: string;
	desired_quantity: number;
	reported_quantity: number | null;
	status: "pending" | "sending" | "confirmed" | "uncertain" | "failed";
};

/**
 * Recomputes the organization's current billable seats, updates the local
 * subscription and, when billing is enabled, brings Stripe to that quantity.
 * Every caller (member hooks, SCIM, reconciliation, departure follow-ups)
 * goes through this per-organization lock, so a delayed earlier delivery can
 * never leave Stripe at an older count. Each new desired quantity is a new
 * generation with its own idempotency key; an interrupted or ambiguous send
 * is marked uncertain and reconciled against Stripe's actual quantity before
 * success is claimed.
 */
export async function deliverOrganizationSeats(input: {
	pool: Pool;
	organizationId: string;
	stripe: SeatStripePort | null;
	requireActiveEmployee?: boolean;
	now?: Instant;
}): Promise<SeatDeliveryOutcome> {
	return withOrganizationSeatLock(input.pool, input.organizationId, async (client) => {
		const seats = await countBillableSeats(drizzle({ client }), input.organizationId, {
			requireActiveEmployee: input.requireActiveEmployee,
			now: input.now,
		});
		const subscription = await client.query<{ stripe_subscription_id: string | null }>(
			`UPDATE subscription SET current_seats = $2, last_seat_reported_at = now(), updated_at = now()
			 WHERE organization_id = $1 RETURNING stripe_subscription_id`,
			[input.organizationId, seats],
		);
		const subscriptionId = subscription.rows[0]?.stripe_subscription_id ?? null;
		if (!input.stripe) return { seats, local: "updated", external: "skipped_disabled" };
		if (!subscriptionId) return { seats, local: "updated", external: "skipped_no_subscription" };

		const existing = await client.query<DeliveryRow>(
			`SELECT generation, desired_quantity, reported_quantity, status
			 FROM billing_seat_delivery WHERE organization_id = $1`,
			[input.organizationId],
		);
		const row = existing.rows[0];
		const current = await input.stripe.getQuantity(subscriptionId);
		if (row && row.status !== "confirmed") {
			// An earlier send may or may not have landed: trust Stripe, not the attempt.
			await client.query(
				`UPDATE billing_seat_delivery
				 SET reported_quantity = $2, status = 'confirmed', last_error = NULL, updated_at = now()
				 WHERE organization_id = $1`,
				[input.organizationId, current.quantity],
			);
		}
		if (current.quantity === seats) {
			return {
				seats,
				local: "updated",
				external: row?.status === "confirmed" ? "unchanged" : "confirmed",
			};
		}

		const generation = Number(row?.generation ?? 0) + 1;
		const idempotencyKey = `seat-sync:${input.organizationId}:${generation}`;
		await client.query(
			`INSERT INTO billing_seat_delivery
			 (organization_id, generation, desired_quantity, reported_quantity, status, idempotency_key)
			 VALUES ($1, $2, $3, $4, 'sending', $5)
			 ON CONFLICT (organization_id) DO UPDATE SET
				generation = EXCLUDED.generation, desired_quantity = EXCLUDED.desired_quantity,
				status = 'sending', idempotency_key = EXCLUDED.idempotency_key, last_error = NULL,
				updated_at = now()`,
			[input.organizationId, generation, seats, current.quantity, idempotencyKey],
		);
		try {
			await input.stripe.setQuantity({
				subscriptionId,
				itemId: current.itemId,
				quantity: seats,
				idempotencyKey,
			});
		} catch (error) {
			await client.query(
				`UPDATE billing_seat_delivery SET status = 'uncertain', last_error = $2, updated_at = now()
				 WHERE organization_id = $1 AND generation = $3`,
				[input.organizationId, errorText(error), generation],
			);
			throw new SeatDeliveryUncertainError(input.organizationId, generation, error);
		}
		await client.query(
			`UPDATE billing_seat_delivery
			 SET status = 'confirmed', reported_quantity = $2, last_error = NULL, updated_at = now()
			 WHERE organization_id = $1 AND generation = $3`,
			[input.organizationId, seats, generation],
		);
		return { seats, local: "updated", external: "confirmed" };
	});
}

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/\s+/g, " ").trim().slice(0, 256);
}
