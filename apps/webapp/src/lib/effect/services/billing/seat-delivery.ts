import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import type { Instant } from "@/lib/datetime/temporal-core";
import { countBillableSeatsByType } from "./billable-seat-count";

/**
 * The subscription's kiosk seat item (#886). `itemId` is null until the item
 * exists; `priceId` is the kiosk seat price for the subscription's interval,
 * used to add the item the first time a kiosk seat appears.
 */
export type KioskSeatItemState = { itemId: string | null; quantity: number; priceId: string };

/** The Stripe operations seat delivery needs; the production adapter wraps StripeService. */
export type SeatStripePort = {
	/**
	 * The full seat item's id and quantity, plus the kiosk seat item when the
	 * port is configured for kiosk seats (absent while kiosk seats are off).
	 */
	getQuantity(
		subscriptionId: string,
	): Promise<{ itemId: string; quantity: number; kiosk?: KioskSeatItemState }>;
	/**
	 * Sets the full seat quantity and, when `kiosk` is given, the kiosk seat
	 * quantity in ONE Stripe request under one idempotency key; a null kiosk
	 * `itemId` adds the kiosk item at `priceId`.
	 */
	setQuantity(input: {
		subscriptionId: string;
		itemId: string;
		quantity: number;
		idempotencyKey: string;
		kiosk?: KioskSeatItemState;
	}): Promise<void>;
};

export type SeatDeliveryOutcome = {
	/** Every billable seat, full and kiosk. */
	seats: number;
	/** The kiosk seat part of `seats`; present only while kiosk seats are on. */
	kioskSeats?: number;
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

/**
 * Stripe subscription statuses that have ended for good: Stripe refuses any
 * update to them and they bill nothing, so seat delivery leaves Stripe alone.
 */
export const ENDED_SUBSCRIPTION_STATUSES: readonly string[] = ["canceled", "incomplete_expired"];

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
 *
 * With `kioskSeats` on (#886) the seats split into full and kiosk seats: one
 * generation carries both quantities in one Stripe request, the kiosk item is
 * added the first time a kiosk seat appears, and reconciliation compares both.
 * Off, every seat is a full seat and the Stripe request is exactly as before.
 */
export async function deliverOrganizationSeats(input: {
	pool: Pool;
	organizationId: string;
	stripe: SeatStripePort | null;
	kioskSeats?: boolean;
	requireActiveEmployee?: boolean;
	now?: Instant;
}): Promise<SeatDeliveryOutcome> {
	const kioskSeats = input.kioskSeats ?? false;
	return withOrganizationSeatLock(input.pool, input.organizationId, async (client) => {
		const split = await countBillableSeatsByType(drizzle({ client }), input.organizationId, {
			kioskSeats,
			requireActiveEmployee: input.requireActiveEmployee,
			now: input.now,
		});
		const seats = split.full + split.kiosk;
		const counted = kioskSeats ? { seats, kioskSeats: split.kiosk } : { seats };
		const subscription = await client.query<{
			stripe_subscription_id: string | null;
			status: string;
		}>(
			`UPDATE subscription
			 SET current_seats = $2, current_kiosk_seats = $3, last_seat_reported_at = now(), updated_at = now()
			 WHERE organization_id = $1 RETURNING stripe_subscription_id, status`,
			[input.organizationId, seats, split.kiosk],
		);
		const local = subscription.rows[0];
		// An ended Stripe subscription is no subscription to deliver to.
		const subscriptionId =
			local && !ENDED_SUBSCRIPTION_STATUSES.includes(local.status)
				? local.stripe_subscription_id
				: null;
		if (!input.stripe) return { ...counted, local: "updated", external: "skipped_disabled" };
		if (!subscriptionId) {
			return { ...counted, local: "updated", external: "skipped_no_subscription" };
		}

		const existing = await client.query<DeliveryRow>(
			`SELECT generation, status FROM billing_seat_delivery WHERE organization_id = $1`,
			[input.organizationId],
		);
		const row = existing.rows[0];
		const current = await input.stripe.getQuantity(subscriptionId);
		const kioskItem = kioskSeats ? current.kiosk : undefined;
		if (kioskSeats && !kioskItem) {
			throw new Error("Kiosk seats are on but the Stripe seat port reports no kiosk seat item");
		}
		if (row && row.status !== "confirmed") {
			// An earlier send may or may not have landed: trust Stripe, not the attempt.
			await client.query(
				`UPDATE billing_seat_delivery
				 SET reported_quantity = $2, reported_kiosk_quantity = $3, status = 'confirmed',
					last_error = NULL, updated_at = now()
				 WHERE organization_id = $1`,
				[input.organizationId, current.quantity, kioskItem?.quantity ?? null],
			);
		}
		if (current.quantity === split.full && (kioskItem?.quantity ?? 0) === split.kiosk) {
			return {
				...counted,
				local: "updated",
				external: row?.status === "confirmed" ? "unchanged" : "confirmed",
			};
		}

		// The kiosk item is added only once a kiosk seat exists; afterwards it stays, at 0 if need be.
		const kiosk =
			kioskItem && (kioskItem.itemId !== null || split.kiosk > 0)
				? { ...kioskItem, quantity: split.kiosk }
				: undefined;
		const generation = Number(row?.generation ?? 0) + 1;
		const idempotencyKey = `seat-sync:${input.organizationId}:${generation}`;
		await client.query(
			`INSERT INTO billing_seat_delivery
			 (organization_id, generation, desired_quantity, reported_quantity,
			  desired_kiosk_quantity, reported_kiosk_quantity, status, idempotency_key)
			 VALUES ($1, $2, $3, $4, $5, $6, 'sending', $7)
			 ON CONFLICT (organization_id) DO UPDATE SET
				generation = EXCLUDED.generation, desired_quantity = EXCLUDED.desired_quantity,
				desired_kiosk_quantity = EXCLUDED.desired_kiosk_quantity,
				status = 'sending', idempotency_key = EXCLUDED.idempotency_key, last_error = NULL,
				updated_at = now()`,
			[
				input.organizationId,
				generation,
				split.full,
				current.quantity,
				split.kiosk,
				kioskItem?.quantity ?? null,
				idempotencyKey,
			],
		);
		try {
			await input.stripe.setQuantity({
				subscriptionId,
				itemId: current.itemId,
				quantity: split.full,
				idempotencyKey,
				...(kiosk ? { kiosk } : {}),
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
			 SET status = 'confirmed', reported_quantity = $2, reported_kiosk_quantity = $4,
				last_error = NULL, updated_at = now()
			 WHERE organization_id = $1 AND generation = $3`,
			[input.organizationId, split.full, generation, kioskItem ? split.kiosk : null],
		);
		return { ...counted, local: "updated", external: "confirmed" };
	});
}

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/\s+/g, " ").trim().slice(0, 256);
}
