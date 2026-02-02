import {
	boolean,
	decimal,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";

/**
 * Subscription records for organizations
 * Source of truth for billing state synced from Stripe
 */
export const subscription = pgTable(
	"subscription",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),

		// Stripe IDs
		stripeCustomerId: text("stripe_customer_id").notNull(),
		stripeSubscriptionId: text("stripe_subscription_id"),
		stripePriceId: text("stripe_price_id"),

		// Subscription state
		status: text("status").notNull(), // trialing, active, past_due, canceled, unpaid
		billingInterval: text("billing_interval"), // month, year

		// Trial
		trialStart: timestamp("trial_start", { withTimezone: true }),
		trialEnd: timestamp("trial_end", { withTimezone: true }),

		// Current period
		currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
		currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),

		// Seat tracking
		currentSeats: integer("current_seats").default(0).notNull(),
		lastSeatReportedAt: timestamp("last_seat_reported_at", { withTimezone: true }),

		// Cancellation
		cancelAt: timestamp("cancel_at", { withTimezone: true }),
		canceledAt: timestamp("canceled_at", { withTimezone: true }),

		// Audit
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),

		// Metadata from Stripe (for debugging)
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
	},
	(table) => [
		index("subscription_organization_id_idx").on(table.organizationId),
		index("subscription_status_idx").on(table.status),
		uniqueIndex("subscription_stripe_customer_id_idx").on(table.stripeCustomerId),
	],
);

/**
 * Stripe webhook events log
 * Idempotency and audit trail for all Stripe events
 */
export const stripeEvent = pgTable(
	"stripe_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		stripeEventId: text("stripe_event_id").notNull().unique(),

		type: text("type").notNull(),

		// Optional org reference (if event is org-scoped)
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "set null",
		}),

		// Event data
		data: jsonb("data").$type<Record<string, unknown>>().notNull(),

		// Processing state
		processed: boolean("processed").default(false).notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		processingError: text("processing_error"),

		// Audit
		receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("stripe_event_stripe_event_id_idx").on(table.stripeEventId),
		index("stripe_event_processed_idx").on(table.processed),
		index("stripe_event_type_idx").on(table.type),
	],
);

/**
 * Seat change audit log
 * Track every member add/remove and Stripe reporting
 */
export const billingSeatAudit = pgTable(
	"billing_seat_audit",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Change details
		action: text("action").notNull(), // member_added, member_removed, stripe_reported
		previousSeats: integer("previous_seats").notNull(),
		newSeats: integer("new_seats").notNull(),

		// Member context (if applicable)
		memberId: text("member_id"),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),

		// Stripe sync
		stripeReported: boolean("stripe_reported").default(false).notNull(),
		stripeUsageRecordId: text("stripe_usage_record_id"),

		// Audit
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		index("billing_seat_audit_organization_id_idx").on(table.organizationId),
		index("billing_seat_audit_created_at_idx").on(table.createdAt),
	],
);

// Type exports for TypeScript
export type Subscription = typeof subscription.$inferSelect;
export type NewSubscription = typeof subscription.$inferInsert;
export type StripeEvent = typeof stripeEvent.$inferSelect;
export type NewStripeEvent = typeof stripeEvent.$inferInsert;
export type BillingSeatAudit = typeof billingSeatAudit.$inferSelect;
export type NewBillingSeatAudit = typeof billingSeatAudit.$inferInsert;
