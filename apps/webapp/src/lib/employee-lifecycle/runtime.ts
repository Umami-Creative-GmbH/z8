/**
 * Production composition for the employee lifecycle, shared by the web app
 * and the BullMQ worker, which resolves `server-only` through its preload
 * (`src/worker-preload.mjs`). Free of Next.js request APIs at call time.
 */
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { type DepartureTaskKind, employeeDeparture } from "@/db/schema/employee-lifecycle";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { type Instant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { runtime } from "@/lib/effect/runtime";
import {
	deliverNotificationToChannel,
	insertInAppNotification,
	loadNotificationChannelPreferences,
} from "@/lib/notifications/notification-service";
import { resolveRecipientNotificationLocale } from "@/lib/notifications/recipient-locale";
import { secondaryStorage } from "@/lib/redis";
import { clockOutFollowUpEffects } from "@/lib/time-tracking/clocking";
import { createApprovalHandoverHandler, createApprovalHandoverRuntime } from "./approval-handover";
import { createDepartureClockOut } from "./clock-out";
import { createClockPostprocessHandler } from "./clock-postprocess";
import { createDepartureCommands } from "./commands";
import type { DepartureTaskHandler } from "./delivery";
import { findDueDepartures } from "./due-departures";
import {
	createReviewNotificationHandler,
	OFFBOARDING_REVIEW_NOTIFICATION_TYPE,
} from "./notifications";
import { createSessionRevocationHandler } from "./session-cleanup";
import type { DepartureIdentity } from "./types";

export function createProductionDepartureCommands() {
	return createDepartureCommands({
		db,
		clock: systemClock,
		clockOut: createDepartureClockOut(),
	});
}

export function listDueDepartures(now: Instant): Promise<DepartureIdentity[]> {
	return findDueDepartures(db, now);
}

export type EmployeeDepartureJobScheduler = (input: {
	identity: DepartureIdentity;
	cutoff: Instant;
}) => Promise<void>;

/**
 * Handlers for durable departure follow-up work; kinds without a handler fail
 * visibly. Billing recomputes the organization's current billable seats (the
 * shared definition) rather than applying a captured increment or decrement,
 * updating the local count even when Stripe is disabled.
 */
export function createProductionDepartureTaskHandlers(options: {
	scheduleDepartureJob: EmployeeDepartureJobScheduler;
}): Partial<Record<DepartureTaskKind, DepartureTaskHandler>> {
	return {
		dispatch_departure: createDispatchDepartureHandler(options.scheduleDepartureJob),
		billing_sync: async (claim) => {
			// Billing loads on first use, outside the web bundles that import this module.
			// No BILLING_ENABLED gate: like the seat reconciliation job, the local seat count
			// is recomputed while billing is disabled; the seat sync then skips Stripe.
			const { BillingServicesLive, SeatSyncService } = await import(
				"@/lib/effect/services/billing"
			);
			await runtime.runPromise(
				Effect.gen(function* () {
					const seatSyncService = yield* SeatSyncService;
					return yield* seatSyncService.syncSeatsForOrganization(claim.organizationId);
				}).pipe(Effect.provide(BillingServicesLive)),
			);
		},
		session_revocation: createSessionRevocationHandler((token) =>
			secondaryStorage.deleteOrThrow(token),
		),
		notify_review: createReviewNotificationHandler({
			database: db,
			clock: systemClock,
			transport: {
				preferences: (userId) =>
					loadNotificationChannelPreferences(userId, OFFBOARDING_REVIEW_NOTIFICATION_TYPE),
				locale: resolveRecipientNotificationLocale,
				insertInApp: insertInAppNotification,
				deliver: (channel, params) => deliverNotificationToChannel(channel, params, null),
			},
		}),
		approval_handover: createApprovalHandoverHandler({
			database: db,
			clock: systemClock,
			runtime: createApprovalHandoverRuntime(
				db as unknown as ApprovalWorkflowDatabase,
				systemClock,
			),
		}),
		// The open clock_repair review is the durable record; nothing is safe to
		// retry automatically against that period.
		clock_repair: async () => {},
		clock_postprocess: createClockPostprocessHandler(clockOutFollowUpEffects),
	};
}

/**
 * Enqueues the delayed execution job for the exact revision the task was
 * created for. An obsolete revision needs no job; the job itself re-validates.
 */
function createDispatchDepartureHandler(
	scheduleDepartureJob: EmployeeDepartureJobScheduler,
): DepartureTaskHandler {
	return async (claim) => {
		const revision = claim.payload.revision;
		if (!claim.departureId || typeof revision !== "number") {
			throw new Error("invalid_dispatch_departure_payload");
		}
		const [departure] = await db
			.select({
				status: employeeDeparture.status,
				revision: employeeDeparture.revision,
				cutoffAt: employeeDeparture.cutoffAt,
			})
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, claim.organizationId),
					eq(employeeDeparture.id, claim.departureId),
				),
			);
		if (!departure || departure.status !== "pending" || departure.revision !== revision) return;
		await scheduleDepartureJob({
			identity: {
				organizationId: claim.organizationId,
				employeeId: claim.employeeId,
				employmentPeriodId: claim.employmentPeriodId,
				departureId: claim.departureId,
				revision,
			},
			cutoff: instantFromDate(departure.cutoffAt),
		});
	};
}
