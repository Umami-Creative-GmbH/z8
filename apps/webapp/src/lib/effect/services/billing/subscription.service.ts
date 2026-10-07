import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { subscription } from "@/db/schema";
import { env } from "@/env";
import { type DatabaseError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { countBillableSeats } from "@/lib/effect/services/billing/billable-seat-count";
import {
	provisionLocalTrial,
	withOrganizationBillingMutation,
	withStripeSubscriptionMutation,
} from "@/lib/effect/services/billing/billing-configuration";

export interface SubscriptionInfo {
	id: string;
	organizationId: string;
	stripeCustomerId: string | null;
	stripeSubscriptionId: string | null;
	status: string;
	isActive: boolean;
	isTrialing: boolean;
	isPastDue: boolean;
	currentSeats: number;
	trialStart: Date | null;
	trialEnd: Date | null;
	currentPeriodEnd: Date | null;
	billingInterval: string | null;
	cancelAt: Date | null;
}

export interface CreateSubscriptionParams {
	organizationId: string;
	stripeCustomerId: string;
	stripeSubscriptionId: string;
	stripePriceId: string;
	status: string;
	billingInterval: string;
	trialEnd: Date | null;
	currentPeriodStart: Date;
	currentPeriodEnd: Date;
	seats: number;
}

export interface UpdateSubscriptionFromStripeParams {
	stripeSubscriptionId: string;
	status: string;
	currentPeriodStart: Date;
	currentPeriodEnd: Date;
	cancelAt?: Date | null;
	canceledAt?: Date | null;
	stripePriceId?: string;
	billingInterval?: string;
}

/**
 * SubscriptionService - CRUD operations for subscription records
 * Manages subscription state in the database
 */
export class SubscriptionService extends Context.Service<
	SubscriptionService,
	{
		readonly getByOrganization: (
			organizationId: string,
		) => Effect.Effect<SubscriptionInfo | null, DatabaseError>;

		readonly getByStripeCustomerId: (
			stripeCustomerId: string,
		) => Effect.Effect<SubscriptionInfo | null, DatabaseError>;

		readonly getByStripeSubscriptionId: (
			stripeSubscriptionId: string,
		) => Effect.Effect<SubscriptionInfo | null, DatabaseError>;

		readonly requireActiveSubscription: (
			organizationId: string,
		) => Effect.Effect<SubscriptionInfo, NotFoundError | DatabaseError>;

		readonly ensureLocalTrial: (params: {
			organizationId: string;
			now?: Date;
		}) => Effect.Effect<SubscriptionInfo, DatabaseError>;

		readonly create: (params: CreateSubscriptionParams) => Effect.Effect<void, DatabaseError>;

		readonly updateFromStripe: (
			params: UpdateSubscriptionFromStripeParams,
		) => Effect.Effect<void, DatabaseError>;

		readonly updateSeatCount: (
			organizationId: string,
			seats: number,
		) => Effect.Effect<void, DatabaseError>;

		readonly setStripeCustomerId: (
			organizationId: string,
			stripeCustomerId: string,
		) => Effect.Effect<void, DatabaseError>;

		readonly canMutateData: (organizationId: string) => Effect.Effect<boolean, DatabaseError>;
	}
>()("SubscriptionService") {}

function mapToSubscriptionInfo(sub: typeof subscription.$inferSelect): SubscriptionInfo {
	const activeStatuses = ["trialing", "active"];
	return {
		id: sub.id,
		organizationId: sub.organizationId,
		stripeCustomerId: sub.stripeCustomerId,
		stripeSubscriptionId: sub.stripeSubscriptionId,
		status: sub.status,
		isActive: activeStatuses.includes(sub.status),
		isTrialing: sub.status === "trialing",
		isPastDue: sub.status === "past_due",
		currentSeats: sub.currentSeats,
		trialStart: sub.trialStart,
		trialEnd: sub.trialEnd,
		currentPeriodEnd: sub.currentPeriodEnd,
		billingInterval: sub.billingInterval,
		cancelAt: sub.cancelAt,
	};
}

export const SubscriptionServiceLive = Layer.effect(
	SubscriptionService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;

		return SubscriptionService.of({
			getByOrganization: (organizationId) =>
				dbService.query("subscription.getByOrganization", async () => {
					const sub = await dbService.db.query.subscription.findFirst({
						where: eq(subscription.organizationId, organizationId),
					});

					if (!sub) return null;
					const currentSeats = await countBillableSeats(dbService.db, organizationId);
					return mapToSubscriptionInfo({ ...sub, currentSeats });
				}),

			getByStripeCustomerId: (stripeCustomerId) =>
				dbService.query("subscription.getByStripeCustomerId", async () => {
					const sub = await dbService.db.query.subscription.findFirst({
						where: eq(subscription.stripeCustomerId, stripeCustomerId),
					});

					if (!sub) return null;
					return mapToSubscriptionInfo(sub);
				}),

			getByStripeSubscriptionId: (stripeSubscriptionId) =>
				dbService.query("subscription.getByStripeSubscriptionId", async () => {
					const sub = await dbService.db.query.subscription.findFirst({
						where: eq(subscription.stripeSubscriptionId, stripeSubscriptionId),
					});

					if (!sub) return null;
					return mapToSubscriptionInfo(sub);
				}),

			requireActiveSubscription: (organizationId) =>
				Effect.gen(function* () {
					const sub = yield* dbService.query("subscription.requireActive", async () => {
						return await dbService.db.query.subscription.findFirst({
							where: eq(subscription.organizationId, organizationId),
						});
					});

					if (!sub) {
						return yield* Effect.fail(
							new NotFoundError({
								message: "No subscription found",
								entityType: "subscription",
								entityId: organizationId,
							}),
						);
					}

					return mapToSubscriptionInfo(sub);
				}),

			ensureLocalTrial: ({ organizationId, now = new Date() }) =>
				dbService.query("subscription.ensureLocalTrial", async () =>
					mapToSubscriptionInfo(await provisionLocalTrial(organizationId, now)),
				),

			create: (params) =>
				dbService.query("subscription.create", () =>
					withOrganizationBillingMutation(params.organizationId, async (transaction) => {
						const existing = await transaction.query.subscription.findFirst({
							where: eq(subscription.organizationId, params.organizationId),
						});

						if (existing) {
							await transaction
								.update(subscription)
								.set({
									stripeCustomerId: params.stripeCustomerId,
									stripeSubscriptionId: params.stripeSubscriptionId,
									stripePriceId: params.stripePriceId,
									status: params.status,
									billingInterval: params.billingInterval,
									trialStart: params.trialEnd ? new Date() : null,
									trialEnd: params.trialEnd,
									currentPeriodStart: params.currentPeriodStart,
									currentPeriodEnd: params.currentPeriodEnd,
									currentSeats: params.seats,
									updatedAt: new Date(),
								})
								.where(eq(subscription.organizationId, params.organizationId));
							return;
						}

						await transaction.insert(subscription).values({
							organizationId: params.organizationId,
							stripeCustomerId: params.stripeCustomerId,
							stripeSubscriptionId: params.stripeSubscriptionId,
							stripePriceId: params.stripePriceId,
							status: params.status,
							billingInterval: params.billingInterval,
							trialStart: params.trialEnd ? new Date() : null,
							trialEnd: params.trialEnd,
							currentPeriodStart: params.currentPeriodStart,
							currentPeriodEnd: params.currentPeriodEnd,
							currentSeats: params.seats,
						});
					}),
				),

			updateFromStripe: (params) =>
				dbService.query("subscription.updateFromStripe", async () => {
					await withStripeSubscriptionMutation(
						params.stripeSubscriptionId,
						async (transaction, scope) => {
							await transaction
								.update(subscription)
								.set({
									status: params.status,
									currentPeriodStart: params.currentPeriodStart,
									currentPeriodEnd: params.currentPeriodEnd,
									cancelAt: params.cancelAt,
									canceledAt: params.canceledAt,
									stripePriceId: params.stripePriceId,
									billingInterval: params.billingInterval,
									updatedAt: new Date(),
								})
								.where(scope);
						},
					);
				}),

			updateSeatCount: (organizationId, seats) =>
				dbService.query("subscription.updateSeatCount", async () => {
					await dbService.db
						.update(subscription)
						.set({
							currentSeats: seats,
							lastSeatReportedAt: new Date(),
						})
						.where(eq(subscription.organizationId, organizationId));
				}),

			setStripeCustomerId: (organizationId, stripeCustomerId) =>
				dbService.query("subscription.setStripeCustomerId", () =>
					withOrganizationBillingMutation(organizationId, async (transaction) => {
						await transaction
							.insert(subscription)
							.values({
								organizationId,
								stripeCustomerId,
								status: "incomplete",
								currentSeats: 0,
							})
							.onConflictDoUpdate({
								target: subscription.organizationId,
								set: {
									stripeCustomerId,
									updatedAt: new Date(),
								},
							});
					}),
				),

			canMutateData: (organizationId) =>
				Effect.gen(function* () {
					// If billing is not enabled, allow all mutations
					if (env.BILLING_ENABLED !== "true") {
						return true;
					}

					const sub = yield* dbService.query("subscription.canMutateData", async () => {
						return await dbService.db.query.subscription.findFirst({
							where: eq(subscription.organizationId, organizationId),
						});
					});

					// No subscription = cannot mutate (needs to subscribe)
					if (!sub) return false;

					if (sub.status === "trialing") {
						return sub.trialEnd !== null && sub.trialEnd.getTime() > Date.now();
					}

					return sub.status === "active";
				}),
		});
	}),
);
