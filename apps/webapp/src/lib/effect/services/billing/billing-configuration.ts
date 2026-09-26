/**
 * Billing as organization configuration for work transactions (#317 / T52,
 * design #258 §"protected non-provisioning billing read").
 *
 * Work transactions revalidate billing with a plain read through their own
 * transaction client while holding the shared organization configuration guard.
 * Every mutation of a fact that read evaluates (subscription existence, status,
 * trial end) takes the exclusive counterpart in its own transaction first, so a
 * billing change is either committed before a work transaction reads it or waits
 * until that transaction ends.
 *
 * Trial provisioning is such a mutation. It runs only before a work transaction,
 * in its own protected transaction, never under a shared guard.
 */
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { subscription } from "@/db/schema";
import { env } from "@/env";
import { dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import {
	acquireExclusiveOrganizationConfigurationGuard,
	withOrganizationConfigurationMutation,
} from "@/lib/time-tracking/organization-configuration-guard";
import type { Transaction, WorkTransactionClient } from "@/lib/time-tracking/work-transaction";
import { countBillableSeats } from "./billable-seat-count";
import { type BillingAccessResult, evaluateBillingAccess } from "./billing-access";

type SubscriptionRow = typeof subscription.$inferSelect;
/** The subscription rows of one Stripe subscription within the protected organizations. */
type ProtectedSubscriptionScope = SQL | undefined;

const TRIAL_DAYS = 14;
const OWNERSHIP_ATTEMPTS = 3;

/**
 * Current billing access through the caller's transaction. Read-only: a missing
 * subscription is denied, never provisioned.
 */
export async function readBillingAccessInTransaction(
	transaction: Pick<WorkTransactionClient, "select">,
	organizationId: string,
	{ now = new Date() }: { now?: Date } = {},
): Promise<BillingAccessResult> {
	const billingEnabled = env.BILLING_ENABLED === "true";
	if (!billingEnabled) return evaluateBillingAccess({ billingEnabled, subscription: null, now });
	const [row] = await transaction
		.select({
			status: subscription.status,
			trialEnd: subscription.trialEnd,
			cancelAt: subscription.cancelAt,
		})
		.from(subscription)
		.where(eq(subscription.organizationId, organizationId))
		.limit(1);
	return evaluateBillingAccess({ billingEnabled, subscription: row ?? null, now });
}

/** A billing mutation for a known organization, under exclusive configuration protection. */
export function withOrganizationBillingMutation<T>(
	organizationId: string,
	mutate: (transaction: Transaction) => Promise<T>,
): Promise<T> {
	return withOrganizationConfigurationMutation(db, organizationId, mutate);
}

/**
 * A billing mutation addressed by Stripe subscription id. The owning
 * organizations are protected before the change; `mutate` must scope its write
 * to them. Ownership that moves while waiting restarts the attempt.
 */
export async function withStripeSubscriptionMutation<T>(
	stripeSubscriptionId: string,
	mutate: (transaction: Transaction, scope: ProtectedSubscriptionScope) => Promise<T>,
): Promise<T | undefined> {
	const owners = async (reader: Pick<Transaction, "select">) =>
		(
			await reader
				.select({ organizationId: subscription.organizationId })
				.from(subscription)
				.where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
		)
			.map(({ organizationId }) => organizationId)
			.sort();
	for (let attempt = 0; attempt < OWNERSHIP_ATTEMPTS; attempt += 1) {
		const outcome = await db.transaction(async (transaction) => {
			const organizationIds = await owners(transaction);
			// No local subscription: the update would match nothing, as before.
			if (organizationIds.length === 0) return { done: true as const, value: undefined };
			// Owners are already sorted, so concurrent writers lock in one order.
			for (const organizationId of organizationIds) {
				await acquireExclusiveOrganizationConfigurationGuard(transaction, organizationId);
			}
			if (JSON.stringify(await owners(transaction)) !== JSON.stringify(organizationIds)) {
				return { done: false as const };
			}
			const scope = and(
				eq(subscription.stripeSubscriptionId, stripeSubscriptionId),
				inArray(subscription.organizationId, organizationIds),
			);
			return { done: true as const, value: await mutate(transaction, scope) };
		});
		if (outcome.done) return outcome.value;
	}
	throw new Error("Stripe subscription ownership kept changing");
}

/**
 * The organization's subscription, creating the default local trial when none
 * exists. Existing rows are returned without protection; only the insert takes
 * exclusive configuration protection, in its own transaction. Never call it
 * inside a work transaction.
 */
export async function provisionLocalTrial(
	organizationId: string,
	now: Date = new Date(),
): Promise<SubscriptionRow> {
	const existing = await db.query.subscription.findFirst({
		where: eq(subscription.organizationId, organizationId),
	});
	if (existing) return existing;

	return withOrganizationBillingMutation(organizationId, async (transaction) => {
		// Exact UTC days: elapsed hours, independent of any zone's DST.
		const trialEnd = dateFromInstant(instantFromDate(now).add({ hours: TRIAL_DAYS * 24 }));
		const currentSeats = await countBillableSeats(transaction, organizationId);
		const [inserted] = await transaction
			.insert(subscription)
			.values({
				organizationId,
				stripeCustomerId: null,
				status: "trialing",
				trialStart: now,
				trialEnd,
				currentSeats,
			})
			.onConflictDoNothing({ target: subscription.organizationId })
			.returning();
		if (inserted) return inserted;

		const raced = await transaction.query.subscription.findFirst({
			where: eq(subscription.organizationId, organizationId),
		});
		if (!raced) throw new Error("Local trial insert returned no row");
		return raced;
	});
}
