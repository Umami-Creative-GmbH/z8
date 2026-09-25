import "server-only";

import { revalidatePath } from "next/cache";
import {
	completeOrdinaryWorkPeriodDecisionAfterCommit,
	reconcileOrdinaryWorkPeriodMaintenanceAfterCommit,
} from "@/lib/approvals/server/work-period-approvals";
import { type Clock, dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import type { BillingSuspensionReason } from "@/lib/effect/services/billing/billing-access";
import { readBillingAccessInTransaction } from "@/lib/effect/services/billing/billing-configuration";
import { CompletedWorkCollisionError } from "@/lib/time-tracking/close-active-work";
import {
	type ManualTimeEntryCommand,
	parseManualTimeEntryCommand,
} from "@/lib/time-tracking/manual-command";
import { withManualWorkTransaction } from "@/lib/time-tracking/manual-work-transaction";
import {
	type ManualWorkRejection,
	type ManualWorkResult,
	type RecordedManualWork,
	recordManualWork,
	replayManualWork,
} from "@/lib/time-tracking/record-manual-work";
import {
	sendManualEntryApprovalNotifications,
	sendManualEntryApprovedNotification,
} from "./approvals";
import { createOrdinaryApprovalRuntime } from "./clocking";
import { reconcileImmediateSurcharges } from "./compliance";
import { MANUAL_ENTRY_TARGET_AUTH_ERROR, resolveManualEntryTarget } from "./manual-entry-target";
import type { ManualActor, ManualPreparationRejection } from "./manual-preparation";
import { prepareManualWork } from "./manual-preparation";
import { logger } from "./shared";
import {
	MANUAL_ENTRY_COLLISION,
	MANUAL_ENTRY_NOT_ADOPTED,
	MANUAL_ENTRY_TARGET_NOT_AUTHORIZED,
	type ManualTimeEntryResult,
} from "./types";

/**
 * Submission of one strict version-2 manual command (#308 / T44).
 *
 * The action authenticates, checks billing (provisioning a default trial if
 * needed) and resolves the currently authorized target, then calls this once.
 * Everything else happens in the manual work transaction: a non-provisioning
 * billing revalidation through the transaction (#317), exact receipt replay (in
 * every mode, before any fresh check), then, only in adopted organizations, one
 * evaluation instant, protected preparation and the completed-work operation.
 * Required
 * notification delivery and best-effort surcharge work run after commit; their
 * failure never turns a committed save into a failure.
 */

export type ManualCommandRejection = ManualPreparationRejection | ManualWorkRejection;

export type ManualCommandOutcome =
	| { kind: "committed"; disposition: "executed" | "replayed"; result: ManualWorkResult }
	| { kind: "rejected"; rejection: ManualCommandRejection }
	/** The organization has not adopted versioned manual commands; nothing was written. */
	| { kind: "not_adopted" }
	/** The identity names other committed work or evidence that no longer stands. */
	| { kind: "collision" }
	/** Billing access ended before the protected read; nothing was replayed or written. */
	| { kind: "billing_required"; reason: BillingSuspensionReason };

export async function submitManualTimeEntryCommand(input: {
	actor: ManualActor;
	/** The currently authorized target, resolved before the transaction. */
	target: { id: string; userId: string };
	command: ManualTimeEntryCommand;
	clock?: Clock;
}): Promise<ManualCommandOutcome> {
	const { actor, target, command } = input;
	const clock = input.clock ?? systemClock;
	// Set by the attempt that committed; a restarted attempt clears it.
	const committed: { write: CommittedWrite | null } = { write: null };
	let outcome: ManualCommandOutcome;
	try {
		outcome = await withManualWorkTransaction(
			{
				organizationId: actor.organizationId,
				actorUserId: actor.userId,
				targetEmployeeId: target.id,
				targetUserId: target.userId,
				submissionId: command.submissionId,
			},
			createOrdinaryApprovalRuntime,
			async (context): Promise<ManualCommandOutcome> => {
				committed.write = null;
				// Billing writers take exclusive protection; this read never provisions.
				const billing = await readBillingAccessInTransaction(context.db, actor.organizationId, {
					now: dateFromInstant(clock.nowInstant()),
				});
				if (!billing.canAccess) {
					return { kind: "billing_required", reason: billing.reason ?? "subscription_required" };
				}
				const replayed = await replayManualWork(context, {
					organizationId: actor.organizationId,
					employeeId: target.id,
					command,
				});
				if (replayed) return { kind: "committed", disposition: "replayed", result: replayed };
				if (context.admission !== "append") return { kind: "not_adopted" };
				// One authoritative instant per attempt, sampled after replay recognition.
				const now = clock.nowInstant();
				const preparation = await prepareManualWork(context, { actor, command, now });
				if (!preparation.ok) return { kind: "rejected", rejection: preparation.rejection };
				const { prepared } = preparation;
				const written = await recordManualWork(context, {
					actorUserId: actor.userId,
					command,
					facts: {
						targetEmployeeId: prepared.target.id,
						targetUserId: prepared.target.userId,
						teamId: prepared.target.teamId,
						organizationId: prepared.target.organizationId,
						isOwnEntry: prepared.isOwnEntry,
						evaluatedAt: prepared.evaluatedAt,
						timezone: prepared.timezone,
						captureSource: prepared.captureSource,
						targetZone: prepared.targetZone,
						start: prepared.interval.start,
						end: prepared.interval.end,
						startOffsetMinutes: prepared.interval.startOffsetMinutes,
						endOffsetMinutes: prepared.interval.endOffsetMinutes,
						durationMinutes: prepared.interval.durationMinutes,
						reason: prepared.reason,
						projectId: prepared.projectId,
						workCategoryId: prepared.workCategoryId,
						daysBack: prepared.daysBack,
						policy: prepared.policy,
						approval: prepared.approval,
					},
				});
				if (written.kind === "rejected") return { kind: "rejected", rejection: written.rejection };
				committed.write = {
					...written,
					organizationId: prepared.target.organizationId,
					reason: prepared.reason,
				};
				return { kind: "committed", disposition: "executed", result: written.result };
			},
		);
	} catch (error) {
		if (error instanceof CompletedWorkCollisionError) return { kind: "collision" };
		throw error;
	}
	if (committed.write) await runPostCommitEffects(committed.write);
	return outcome;
}

async function bestEffort(operation: () => Promise<unknown>, message: string, context: object) {
	try {
		await operation();
	} catch (error) {
		logger.error({ error, ...context }, message);
	}
}

type CommittedWrite = Extract<RecordedManualWork, { kind: "executed" }> & {
	organizationId: string;
	reason: string;
};

async function runPostCommitEffects(recorded: CommittedWrite) {
	const { result, approvalSubmission, surchargeSnapshot, organizationId } = recorded;
	const scope = { organizationId, workPeriodId: result.workPeriodId };
	if (approvalSubmission?.disposition === "executed") {
		await completeOrdinaryWorkPeriodDecisionAfterCommit({
			execute: async () => approvalSubmission,
			dispatchPending: true,
			dispatch: async (execution) => {
				const descriptor = execution.postCommit;
				const managerId = descriptor?.approverEmployeeId;
				if (!descriptor || !managerId) return;
				const params = {
					workPeriodId: result.workPeriodId,
					employeeId: result.owner.employeeId,
					managerId,
					organizationId,
					startTime: new Date(result.segment.startAt),
					endTime: new Date(result.segment.endAt),
					durationMinutes: result.segment.durationMinutes,
					reason: recorded.reason,
					dedupeKey: descriptor.dedupeKey,
				};
				await (descriptor.event === "approved"
					? sendManualEntryApprovedNotification(params)
					: sendManualEntryApprovalNotifications(params));
			},
			maintain: reconcileOrdinaryWorkPeriodMaintenanceAfterCommit,
			onDispatchError: (error) =>
				logger.error(
					{ error, ...scope },
					"Failed to dispatch manual-entry approval notification after commit",
				),
			onMaintenanceError: (error) =>
				logger.error(
					{ error, ...scope },
					"Failed to reconcile manual-entry approval maintenance after commit",
				),
		});
	}
	if (surchargeSnapshot) {
		await bestEffort(
			() =>
				reconcileImmediateSurcharges({
					affectedWorkPeriodIds: [result.workPeriodId],
					employeeId: result.owner.employeeId,
					organizationId,
					snapshot: surchargeSnapshot,
				}),
			"Failed to calculate surcharges after manual time entry",
			scope,
		);
	}
	await bestEffort(
		async () => revalidatePath("/time-tracking"),
		"Failed to revalidate time tracking after manual entry",
		scope,
	);
	logger.info(
		{
			...scope,
			employeeId: result.owner.employeeId,
			startAt: result.segment.startAt,
			endAt: result.segment.endAt,
			approvalState: result.approvalState,
			evaluatedAt: result.interpretation.evaluatedAt,
		},
		"Manual time entry created through the completed-work operation",
	);
}

const REJECTION_MESSAGES: Record<ManualCommandRejection["reason"], string> = {
	invalid_command: "Some entry fields are invalid. Please review them and try again.",
	reconfirmation_required:
		"The timezone or times changed. Please review and confirm the entry again.",
	nonexistent_time: "This time does not exist on that date because of a daylight saving change.",
	occurrence_required: "This time occurs twice on that date. Please choose which one you mean.",
	nonpositive_interval: "Clock out time must be after clock in time",
	future_endpoint: "Cannot create entries for future times",
	interval_too_long: "A manual entry cannot be longer than 24 hours.",
	target_not_authorized: MANUAL_ENTRY_TARGET_AUTH_ERROR,
	holiday_blocked: "errors.holiday.blocksTimeEntry",
	project_ineligible: "Cannot assign to this project",
	category_ineligible: "Cannot assign to this work category",
	policy_ambiguous: "Could not verify time approval policy. Please try again.",
	occupancy_conflict:
		"This time overlaps recorded work. Please choose a time range that does not overlap existing entries.",
	append_review_required:
		"This employee's time history needs review before new entries can be saved. Please contact your administrator.",
};

/**
 * The action entry for a version-2 command, after authentication and billing.
 * The currently authorized target is resolved before replay, as for legacy
 * submissions; the submission itself revalidates it under protection.
 */
export async function createManualTimeEntryFromCommand(input: {
	value: unknown;
	session: { userId: string; isPlatformAdmin: boolean };
	currentEmployee: Parameters<typeof resolveManualEntryTarget>[0]["currentEmployee"];
}): Promise<ManualTimeEntryResult> {
	const parsed = parseManualTimeEntryCommand(input.value);
	if (!parsed.ok) {
		return {
			success: false,
			error: REJECTION_MESSAGES.invalid_command,
			code: "invalid_command",
			rejection: parsed.rejection,
		};
	}
	const { command } = parsed;
	const target = await resolveManualEntryTarget({
		currentEmployee: input.currentEmployee,
		requestedEmployeeId: command.targetEmployeeId,
	});
	if (!target.success) {
		return { success: false, error: target.error, code: MANUAL_ENTRY_TARGET_NOT_AUTHORIZED };
	}
	let outcome: ManualCommandOutcome;
	try {
		outcome = await submitManualTimeEntryCommand({
			actor: {
				userId: input.session.userId,
				organizationId: input.currentEmployee.organizationId,
				isPlatformAdmin: input.session.isPlatformAdmin,
			},
			target: target.targetEmployee,
			command,
		});
	} catch (error) {
		// Required approval without a routable approver rolled back atomically.
		if (
			error instanceof ValidationError &&
			error.field === "managerId" &&
			error.message === "No manager assigned to approve time changes"
		) {
			return { success: false, error: error.message };
		}
		logger.error({ error, submissionId: command.submissionId }, "Failed to submit manual command");
		return { success: false, error: "Failed to create time entry. Please try again." };
	}
	switch (outcome.kind) {
		case "committed": {
			const { result } = outcome;
			return {
				success: true,
				data: {
					workPeriodId: result.workPeriodId,
					requiresApproval:
						result.approval.participation === "manual_time_submission" &&
						result.approval.outcome !== "auto_completed",
					disposition: outcome.disposition,
				},
			};
		}
		case "not_adopted":
			return {
				success: false,
				error: "Manual entry settings changed. Please review the entry and submit it again.",
				code: MANUAL_ENTRY_NOT_ADOPTED,
			};
		case "billing_required":
			return { success: false, error: "billing_required", code: outcome.reason };
		case "collision":
			return {
				success: false,
				error:
					"This entry conflicts with an earlier submission or changed work. Please check your existing entries.",
				code: MANUAL_ENTRY_COLLISION,
			};
		case "rejected": {
			const { rejection } = outcome;
			return {
				success: false,
				error:
					rejection.reason === "project_ineligible" || rejection.reason === "category_ineligible"
						? rejection.message
						: REJECTION_MESSAGES[rejection.reason],
				code: rejection.reason,
				rejection,
				...(rejection.reason === "holiday_blocked" ? { holidayName: rejection.holidayName } : {}),
			};
		}
	}
}
