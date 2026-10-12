import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { db } from "@/db";
import { automaticClockOutExecution, automaticClockOutTask, timeEntry } from "@/db/schema";
import {
	type Clock,
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	forwardedNotification,
	resolveNotificationRecipients,
} from "@/lib/notifications/kiosk-only-recipients";
import {
	type CreateNotificationParams,
	NOTIFICATION_CHANNELS,
	type NotificationChannel,
} from "@/lib/notifications/types";
import type { ClockOutFollowUpEffects, ClosedLiveWork } from "../clocking/follow-ups";
import { parsePolicyClockOutSurchargeSnapshot } from "../policy-clock-out-surcharge-snapshot";
import { deriveWorkDurationMinutes } from "../work-duration";
import { runAutoClockOutFollowUps } from "./follow-ups";
import { buildAutoClockOutNotification, planAutoClockOutChannels } from "./notifications";
import { AutoClockOutTaskLeaseNotOwnedError, createAutoClockOutTaskOutbox } from "./outbox";
import type {
	AutoClockOutDecision,
	AutoClockOutDeliveryResult,
	AutoClockOutTaskClaim,
} from "./types";

const logger = createLogger("AutomaticClockOutDelivery");
const capture = z.object({
	timezone: z.string().nullable(),
	utcOffsetMinutes: z.number().int().min(-840).max(840),
	timezoneSource: z.enum([
		"browser",
		"user_setting",
		"manager_target_user_setting",
		"system_target_user_setting",
		"historical_inference",
		"backfill",
	]),
});
const closureSchema = z.object({
	version: z.literal(1),
	reason: z.literal("automatic_clock_out"),
	organizationId: z.string(),
	employeeId: z.string().uuid(),
	actorUserId: z.string().min(1),
	completingActor: z.object({
		kind: z.literal("system"),
		process: z.literal("automatic_clock_out"),
	}),
	workPeriodId: z.string().uuid(),
	clockOutEntryId: z.string().uuid(),
	start: z.string(),
	end: z.string(),
	durationMinutes: z.number().int().positive(),
	timezone: z.string(),
	projectId: z.string().uuid().nullable(),
	workCategoryId: z.string().uuid().nullable(),
	surchargeSnapshot: z.unknown(),
	balanceRefreshCommitted: z.boolean(),
	startCapture: capture,
	endCapture: capture,
});

export type AutoClockOutNotificationTransport = {
	preferences(userId: string): Promise<Record<NotificationChannel, boolean>>;
	locale(input: { userId: string; organizationId: string }): Promise<string>;
	insertInApp(params: CreateNotificationParams): Promise<unknown>;
	deliver(
		channel: Exclude<NotificationChannel, "in_app">,
		params: CreateNotificationParams,
	): Promise<"sent" | "unavailable">;
};

/** Whether the execution's clock-out entry ended the work at `end`, in its tenant. */
async function isClockOutEntryAt(
	database: typeof db,
	execution: typeof automaticClockOutExecution.$inferSelect,
	end: Instant,
) {
	const [entry] = await database
		.select({ type: timeEntry.type, timestamp: timeEntry.timestamp })
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, execution.organizationId),
				eq(timeEntry.employeeId, execution.employeeId),
				eq(timeEntry.id, execution.clockOutEntryId),
			),
		)
		.limit(1);
	return entry?.type === "clock_out" && instantFromDate(entry.timestamp).equals(end);
}

async function loadFacts(database: typeof db, claim: AutoClockOutTaskClaim) {
	if (claim.payload.version !== 1 || claim.payload.operationId !== claim.operationId)
		throw new Error("invalid_task_payload");
	const [execution] = await database
		.select()
		.from(automaticClockOutExecution)
		.where(
			and(
				eq(automaticClockOutExecution.organizationId, claim.organizationId),
				eq(automaticClockOutExecution.employeeId, claim.employeeId),
				eq(automaticClockOutExecution.id, claim.operationId),
			),
		);
	if (!execution) throw new Error("execution_not_found");
	const payload = closureSchema.parse(execution.closurePayload);
	const start = parseInstant(payload.start),
		end = parseInstant(payload.end);
	const cutoff = instantFromDate(execution.cutoffTime);
	// The closure ends at the cutoff, or earlier at a forgotten break's start (#861),
	// which its clock-out entry records.
	const atBreakStart = compareInstants(end, cutoff) < 0;
	if (
		payload.organizationId !== claim.organizationId ||
		payload.employeeId !== claim.employeeId ||
		payload.workPeriodId !== execution.workPeriodId ||
		payload.clockOutEntryId !== execution.clockOutEntryId ||
		payload.actorUserId !== execution.provenanceUserId ||
		payload.timezone !== execution.timezone ||
		!start.equals(instantFromDate(execution.startTime)) ||
		(atBreakStart
			? compareInstants(end, start) <= 0 ||
				payload.durationMinutes !== deriveWorkDurationMinutes(start, end) ||
				!(await isClockOutEntryAt(database, execution, end))
			: !end.equals(cutoff) ||
				payload.durationMinutes !== execution.maxUninterruptedMinutes ||
				!start.add({ minutes: payload.durationMinutes }).equals(end)) ||
		payload.endCapture.utcOffsetMinutes !== execution.utcOffsetMinutes ||
		payload.endCapture.timezone !== execution.timezone ||
		end.toZonedDateTimeISO(execution.timezone).offsetNanoseconds / 60e9 !==
			execution.utcOffsetMinutes
	)
		throw new Error("invalid_closure_facts");
	if (payload.startCapture.timezone) start.toZonedDateTimeISO(payload.startCapture.timezone);
	const closure: ClosedLiveWork = {
		...payload,
		start,
		end,
		surchargeSnapshot:
			payload.surchargeSnapshot === null
				? null
				: parsePolicyClockOutSurchargeSnapshot(payload.surchargeSnapshot, end.toString()),
	};
	const decision: AutoClockOutDecision = {
		organizationId: execution.organizationId,
		employeeId: execution.employeeId,
		workPeriodId: execution.workPeriodId,
		operationId: execution.id,
		provenanceUserId: execution.provenanceUserId,
		start,
		cutoff,
		...(atBreakStart ? { closesAt: end } : {}),
		timezone: execution.timezone,
		settings: {
			autoClockOutEnabled: true,
			maxUninterruptedMinutes: execution.maxUninterruptedMinutes,
			revision: execution.settingsRevision,
		},
	};
	return { closure, decision, recipientUserId: execution.recipientUserId };
}

/** Composition seam for the existing effect/transport owners, also exercised against PostgreSQL. */
export function createAutoClockOutDelivery(deps: {
	database: typeof db;
	clock: Clock;
	effects: ClockOutFollowUpEffects;
	transport: AutoClockOutNotificationTransport;
}) {
	const outbox = createAutoClockOutTaskOutbox(deps.database);
	const resolveRecipients = (userId: string, organizationId: string) =>
		resolveNotificationRecipients(deps.database, { userId, organizationId });
	return async (limit: number): Promise<AutoClockOutDeliveryResult> => {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
			throw new Error("invalid_task_limit");
		const result = { claimed: 0, completed: 0, deferred: 0, failed: 0 };
		while (result.claimed < limit) {
			const claims = await outbox.claimDue(deps.clock.nowInstant(), limit - result.claimed);
			if (claims.length === 0) break;
			result.claimed += claims.length;
			for (const claim of claims) {
				const recordProgress = (patch: Record<string, unknown>) =>
					outbox.recordProgress(claim, deps.clock.nowInstant(), patch);
				try {
					// Renew/assert ownership immediately before starting any effect in this batch.
					await recordProgress({});
					const facts = await loadFacts(deps.database, claim);
					if (claim.kind === "follow_up") {
						await runAutoClockOutFollowUps(
							facts.closure,
							claim.payload,
							{ recordProgress },
							deps.effects,
						);
					} else if (claim.kind === "plan_notification") {
						const stageChannels = async (
							recipientUserId: string,
							channels: NotificationChannel[],
						) => {
							if (channels.length === 0) return;
							const now = dateFromInstant(deps.clock.nowInstant());
							await deps.database
								.insert(automaticClockOutTask)
								.values(
									channels.map((channel) => ({
										organizationId: claim.organizationId,
										employeeId: claim.employeeId,
										operationId: claim.operationId,
										kind: "notification_channel" as const,
										dedupeKey: `notification:${claim.operationId}:${recipientUserId}:${channel}`,
										payload: {
											version: 1,
											operationId: claim.operationId,
											recipientUserId,
											channel,
										},
										availableAt: now,
										createdAt: now,
										updatedAt: now,
									})),
								)
								.onConflictDoNothing({
									target: [automaticClockOutTask.organizationId, automaticClockOutTask.dedupeKey],
								});
						};
						// A kiosk-only employee's notice goes to their managers instead (spec #761).
						const recipients = await resolveRecipients(facts.recipientUserId, claim.organizationId);
						const recipientUserIds =
							recipients.kind === "self" ? [facts.recipientUserId] : recipients.userIds;
						if (recipientUserIds.length === 0)
							logger.warn(
								{ organizationId: claim.organizationId, employeeId: claim.employeeId },
								"Kiosk-only employee's automatic clock-out notice has no manager to receive it",
							);
						// Optional configuration/transport outages must not delay the mandatory inbox.
						for (const recipientUserId of recipientUserIds)
							await stageChannels(recipientUserId, ["in_app"]);
						for (const recipientUserId of recipientUserIds) {
							const preferences = await deps.transport.preferences(recipientUserId);
							// Each enabled channel owns its availability lookup and retry independently.
							await stageChannels(recipientUserId, planAutoClockOutChannels(preferences));
						}
					} else if (claim.kind === "notification_channel") {
						const channel = z.enum(NOTIFICATION_CHANNELS).parse(claim.payload.channel);
						const recipientUserId = String(claim.payload.recipientUserId);
						const recipients = await resolveRecipients(facts.recipientUserId, claim.organizationId);
						if (
							recipients.kind === "self"
								? recipientUserId !== facts.recipientUserId
								: !recipients.userIds.includes(recipientUserId)
						)
							throw new Error("invalid_notification_recipient");
						if (!["sent", "unavailable", "suppressed"].includes(String(claim.payload.outcome))) {
							const preferences =
								channel === "in_app" ? null : await deps.transport.preferences(recipientUserId);
							if (preferences && !preferences[channel])
								await recordProgress({ outcome: "suppressed" });
							else {
								const locale = await deps.transport.locale({
									userId: recipientUserId,
									organizationId: claim.organizationId,
								});
								const own = buildAutoClockOutNotification({
									decision: facts.decision,
									recipientUserId: facts.recipientUserId,
									locale,
								});
								const notification =
									recipients.kind === "self"
										? own
										: forwardedNotification(own, recipients.employee, recipientUserId);
								if (channel === "in_app") {
									await deps.transport.insertInApp(notification);
									await recordProgress({ outcome: "sent" });
								} else
									await recordProgress({
										outcome: await deps.transport.deliver(channel, notification),
									});
							}
						}
					} else throw new Error("unsupported_task_kind");
					await outbox.complete(claim, deps.clock.nowInstant());
					result.completed++;
				} catch (error) {
					try {
						if (error instanceof AutoClockOutTaskLeaseNotOwnedError) throw error;
						const outcome = await outbox.defer(claim, deps.clock.nowInstant(), error);
						result[outcome]++;
					} catch (persistenceError) {
						logger.warn(
							{
								organizationId: claim.organizationId,
								taskId: claim.id,
								staleOwnership: persistenceError instanceof AutoClockOutTaskLeaseNotOwnedError,
							},
							"Automatic clock-out task outcome could not be persisted",
						);
						result.deferred++;
					}
				}
			}
		}
		return result;
	};
}

export async function runAutoClockOutDelivery(deps: {
	database: typeof db;
	clock: Clock;
	limit: number;
}): Promise<AutoClockOutDeliveryResult> {
	const [
		{ clockOutFollowUpEffects },
		{ checkComplianceAfterClockOut, checkProjectBudgetAfterClockOut },
		service,
		{ resolveRecipientNotificationLocale },
	] = await Promise.all([
		import("../clocking"),
		import("../clock-out-effects"),
		import("@/lib/notifications/notification-service"),
		import("@/lib/notifications/recipient-locale"),
	]);
	return createAutoClockOutDelivery({
		...deps,
		effects: {
			...clockOutFollowUpEffects,
			checkCompliance: (input) => checkComplianceAfterClockOut(input, { throwOnError: true }),
			checkProjectBudget: (projectId, organizationId) =>
				checkProjectBudgetAfterClockOut(projectId, organizationId, { throwOnError: true }),
		},
		transport: {
			preferences: (userId) =>
				service.loadNotificationChannelPreferences(userId, "automatic_clock_out"),
			locale: resolveRecipientNotificationLocale,
			insertInApp: service.insertInAppNotification,
			deliver: (channel, params) =>
				service.deliverNotificationToChannel(channel, params, null, { durable: true }),
		},
	})(deps.limit);
}
