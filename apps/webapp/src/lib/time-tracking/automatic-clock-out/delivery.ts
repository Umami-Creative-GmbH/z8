import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { db } from "@/db";
import {
	automaticClockOutExecution,
	automaticClockOutTask,
	type ChatInstallationProvider,
	type ChatNotificationDispatchRedactedDiagnostics,
	chatInstallation,
	timeEntry,
} from "@/db/schema";
import {
	extractRedactedErrorDiagnostics,
	isChatInstallationProvider,
	isConfirmedUnsentError,
	isUncertainDispatchError,
	markDurableDispatchConfirmedUnsent,
	markDurableDispatchSent,
	markDurableDispatchUncertain,
	type RecordDurableDispatchIntentResult,
	recordDurableDispatchIntent,
} from "@/lib/chat-installations/durable-dispatch";
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
import type { ClosedLiveWork } from "../clocking/follow-ups";
import { parsePolicyClockOutSurchargeSnapshot } from "../policy-clock-out-surcharge-snapshot";
import { deriveWorkDurationMinutes } from "../work-duration";
import { type AutoClockOutFollowUpEffects, runAutoClockOutFollowUps } from "./follow-ups";
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

export type AutoClockOutChatDispatchContext = {
	attemptId: string;
	installationId: string | null;
	credentialRevisionId: string | null;
};

export type AutoClockOutNotificationTransport = {
	preferences(userId: string): Promise<Record<NotificationChannel, boolean>>;
	insertInApp(params: CreateNotificationParams): Promise<unknown>;
	deliver(
		channel: Exclude<NotificationChannel, "in_app">,
		params: CreateNotificationParams,
		dispatchContext?: AutoClockOutChatDispatchContext,
	): Promise<"sent" | "unavailable">;
};

export type AutoClockOutDurableChatDispatchGuard = {
	recordIntent: (input: {
		organizationId: string;
		provider: ChatInstallationProvider;
		sourceRefId: string;
		dedupeKey: string;
	}) => Promise<RecordDurableDispatchIntentResult>;
	markSent: (input: { organizationId: string; attemptId: string }) => Promise<unknown>;
	markConfirmedUnsent: (input: {
		organizationId: string;
		attemptId: string;
		diagnostics?: ChatNotificationDispatchRedactedDiagnostics;
	}) => Promise<unknown>;
	markUncertain: (input: {
		organizationId: string;
		attemptId: string;
		classification?: "ambiguous" | "worker_lost" | "provider_error";
		diagnostics?: ChatNotificationDispatchRedactedDiagnostics;
	}) => Promise<unknown>;
	hasActiveInstallation: (
		organizationId: string,
		provider: ChatInstallationProvider,
	) => Promise<boolean>;
};

export type DurableChatChannelOutcome =
	| "sent"
	| "unavailable"
	| "reconciliation_required"
	| "closed_unknown";

/**
 * Executes a persistent chat notification channel delivery through the durable dispatch
 * ledger: commits the selected installation + credential revision intent BEFORE invoking
 * `deliver`, quarantines uncertain/crashed outcomes to `reconciliation_required` without
 * resending, and allows safe rerouting only after an explicit `confirmed_unsent` failure.
 */
export async function executeDurableChatChannelDelivery(input: {
	organizationId: string;
	provider: ChatInstallationProvider;
	sourceRefId: string;
	dedupeKey: string;
	notification: CreateNotificationParams;
	deliver: AutoClockOutNotificationTransport["deliver"];
	guard: AutoClockOutDurableChatDispatchGuard;
}): Promise<{
	outcome: DurableChatChannelOutcome;
	dispatchAttemptId: string;
	installationId: string | null;
}> {
	const intent = await input.guard.recordIntent({
		organizationId: input.organizationId,
		provider: input.provider,
		sourceRefId: input.sourceRefId,
		dedupeKey: input.dedupeKey,
	});

	if (intent.kind === "already_sent") {
		return {
			outcome: "sent",
			dispatchAttemptId: intent.attempt.id,
			installationId: intent.attempt.installationId,
		};
	}

	if (intent.kind === "reconciliation_required") {
		return {
			outcome: "reconciliation_required",
			dispatchAttemptId: intent.attempt.id,
			installationId: intent.attempt.installationId,
		};
	}

	if (intent.kind === "closed_unknown") {
		return {
			outcome: "closed_unknown",
			dispatchAttemptId: intent.attempt.id,
			installationId: intent.attempt.installationId,
		};
	}

	const { attempt } = intent;
	try {
		const deliveryOutcome = await input.deliver(input.provider, input.notification, {
			attemptId: attempt.id,
			installationId: attempt.installationId,
			credentialRevisionId: attempt.credentialRevisionId,
		});

		if (deliveryOutcome === "sent") {
			await input.guard.markSent({
				organizationId: input.organizationId,
				attemptId: attempt.id,
			});
			return {
				outcome: "sent",
				dispatchAttemptId: attempt.id,
				installationId: attempt.installationId,
			};
		}

		await input.guard.markConfirmedUnsent({
			organizationId: input.organizationId,
			attemptId: attempt.id,
			diagnostics: { reason: "channel_or_destination_unavailable" },
		});
		return {
			outcome: "unavailable",
			dispatchAttemptId: attempt.id,
			installationId: attempt.installationId,
		};
	} catch (error) {
		if (isConfirmedUnsentError(error)) {
			await input.guard.markConfirmedUnsent({
				organizationId: input.organizationId,
				attemptId: attempt.id,
				diagnostics: extractRedactedErrorDiagnostics(error, "confirmed_unsent_preflight_error"),
			});
			throw error;
		}

		const shouldQuarantine =
			isUncertainDispatchError(error) ||
			attempt.installationId !== null ||
			(await input.guard.hasActiveInstallation(input.organizationId, input.provider));

		if (shouldQuarantine) {
			await input.guard.markUncertain({
				organizationId: input.organizationId,
				attemptId: attempt.id,
				classification: isUncertainDispatchError(error) ? error.classification : "ambiguous",
				diagnostics: extractRedactedErrorDiagnostics(error, "provider_delivery_uncertain"),
			});
			return {
				outcome: "reconciliation_required",
				dispatchAttemptId: attempt.id,
				installationId: attempt.installationId,
			};
		}

		await input.guard.markConfirmedUnsent({
			organizationId: input.organizationId,
			attemptId: attempt.id,
			diagnostics: extractRedactedErrorDiagnostics(error, "pre_installation_transport_error"),
		});
		throw error;
	}
}

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
	return {
		closure,
		decision,
		// The auto clock-out entry's stored offset, which the notice shows the cutoff at (#1149).
		endUtcOffsetMinutes: execution.utcOffsetMinutes,
		recipientUserId: execution.recipientUserId,
	};
}

/** Composition seam for the existing effect/transport owners, also exercised against PostgreSQL. */
export function createAutoClockOutDelivery(deps: {
	database: typeof db;
	clock: Clock;
	effects: AutoClockOutFollowUpEffects;
	transport: AutoClockOutNotificationTransport;
	durableChatDispatch?: AutoClockOutDurableChatDispatchGuard;
}) {
	const outbox = createAutoClockOutTaskOutbox(deps.database);
	const resolveRecipients = (userId: string, organizationId: string) =>
		resolveNotificationRecipients(deps.database, { userId, organizationId });
	const dispatchDeps = {
		db: deps.database,
		now: () => dateFromInstant(deps.clock.nowInstant()),
	};
	const durableChatDispatch: AutoClockOutDurableChatDispatchGuard = deps.durableChatDispatch ?? {
		recordIntent: (input) =>
			recordDurableDispatchIntent(
				{
					organizationId: input.organizationId,
					provider: input.provider,
					sourceKind: "persistent_notification",
					sourceRefId: input.sourceRefId,
					dedupeKey: input.dedupeKey,
				},
				dispatchDeps,
			),
		markSent: (input) => markDurableDispatchSent(input, dispatchDeps),
		markConfirmedUnsent: (input) => markDurableDispatchConfirmedUnsent(input, dispatchDeps),
		markUncertain: (input) => markDurableDispatchUncertain(input, dispatchDeps),
		hasActiveInstallation: async (organizationId, provider) => {
			const [row] = await deps.database
				.select({ id: chatInstallation.id })
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.organizationId, organizationId),
						eq(chatInstallation.provider, provider),
						eq(chatInstallation.status, "active"),
					),
				)
				.limit(1);
			return Boolean(row);
		},
	};
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
						if (
							![
								"sent",
								"unavailable",
								"suppressed",
								"reconciliation_required",
								"closed_unknown",
							].includes(String(claim.payload.outcome))
						) {
							const preferences =
								channel === "in_app" ? null : await deps.transport.preferences(recipientUserId);
							if (preferences && !preferences[channel])
								await recordProgress({ outcome: "suppressed" });
							else {
								// Stored in English; each channel renders it in the recipient language (#1149).
								const own = buildAutoClockOutNotification({
									decision: facts.decision,
									recipientUserId: facts.recipientUserId,
									endUtcOffsetMinutes: facts.endUtcOffsetMinutes,
								});
								const notification =
									recipients.kind === "self"
										? own
										: forwardedNotification(own, recipients.employee, recipientUserId);
								if (channel === "in_app") {
									await deps.transport.insertInApp(notification);
									await recordProgress({ outcome: "sent" });
								} else if (isChatInstallationProvider(channel)) {
									const dedupeKey =
										claim.dedupeKey ??
										`notification:${claim.operationId}:${recipientUserId}:${channel}`;
									const dispatchOutcome = await executeDurableChatChannelDelivery({
										organizationId: claim.organizationId,
										provider: channel,
										sourceRefId: claim.id,
										dedupeKey,
										notification,
										deliver: deps.transport.deliver,
										guard: durableChatDispatch,
									});
									await recordProgress({
										outcome: dispatchOutcome.outcome,
										dispatchAttemptId: dispatchOutcome.dispatchAttemptId,
										installationId: dispatchOutcome.installationId,
									});
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
		{ automaticClockOutComplianceEffects, checkProjectBudgetAfterClockOut },
		service,
	] = await Promise.all([
		import("../clocking"),
		import("../clock-out-effects"),
		import("@/lib/notifications/notification-service"),
	]);
	return createAutoClockOutDelivery({
		...deps,
		effects: {
			...clockOutFollowUpEffects,
			...automaticClockOutComplianceEffects,
			checkProjectBudget: (projectId, organizationId) =>
				checkProjectBudgetAfterClockOut(projectId, organizationId, { throwOnError: true }),
		},
		transport: {
			preferences: (userId) =>
				service.loadNotificationChannelPreferences(userId, "automatic_clock_out"),
			insertInApp: service.insertInAppNotification,
			deliver: (channel, params, dispatchContext) =>
				service.deliverNotificationToChannel(channel, params, null, {
					durable: true,
					...(dispatchContext
						? {
								dispatchTarget: {
									installationId: dispatchContext.installationId,
									credentialRevisionId: dispatchContext.credentialRevisionId,
								},
							}
						: {}),
				}),
		},
	})(deps.limit);
}
