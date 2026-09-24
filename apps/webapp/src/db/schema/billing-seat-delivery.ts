import { bigint, check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "../auth-schema";
import { currentTimestamp } from "./timestamp";

export const billingSeatDeliveryStatuses = [
	"pending",
	"sending",
	"confirmed",
	"uncertain",
	"failed",
] as const;

/**
 * Ordered seat-quantity delivery to Stripe, one row per organization. Each new
 * desired quantity gets a new generation whose idempotency key binds exactly
 * one Stripe request; an interrupted or ambiguous request is left `uncertain`
 * and reconciled against Stripe before success is claimed.
 */
export const billingSeatDelivery = pgTable(
	"billing_seat_delivery",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		generation: bigint("generation", { mode: "number" }).default(0).notNull(),
		desiredQuantity: integer("desired_quantity").notNull(),
		reportedQuantity: integer("reported_quantity"),
		status: text("status").$type<(typeof billingSeatDeliveryStatuses)[number]>().notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		lastError: text("last_error"),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	() => [
		check(
			"billingSeatDelivery_status_check",
			sql.raw(
				`status IN (${billingSeatDeliveryStatuses.map((status) => `'${status}'`).join(", ")})`,
			),
		),
		check(
			"billingSeatDelivery_quantity_check",
			sql`desired_quantity >= 0 AND (reported_quantity IS NULL OR reported_quantity >= 0)`,
		),
		check("billingSeatDelivery_generation_check", sql`generation >= 0`),
	],
);

export type BillingSeatDelivery = typeof billingSeatDelivery.$inferSelect;
