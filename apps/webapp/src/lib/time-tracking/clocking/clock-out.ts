import "server-only";

import { canonicalWorkRecordClient } from "@/app/[locale]/(app)/time-tracking/actions.canonical";
import type { employee } from "@/db/schema";
import { executeOrdinaryWorkPeriodSubmissionInTransaction } from "@/lib/approvals/server/work-period-submission";
import { POLICY_CLOCK_OUT_APPROVAL_REASON } from "@/lib/approvals/time-request-kind";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import { clockingService } from "../clocking-service";
import {
	attributionValue,
	type CloseActiveWorkCommand,
	type CloseActiveWorkReceipt,
	type CloseActiveWorkWriter,
	clockSource,
	closeActiveWork,
	liveClockOutWriter,
	replayCloseActiveWork,
} from "../close-active-work";
import { approvalDbServiceForTransaction } from "../ordinary-approval-runtime";
import {
	findPolicyClockOutSubmissionEvidence,
	requireReplayOnlySubmission,
} from "../ordinary-submission-evidence";
import {
	type PolicyClockOutSurchargeSnapshot,
	resolvePolicyClockOutSurchargeSnapshotInTransaction,
} from "../policy-clock-out-surcharge-snapshot";
import type { TimeEntryTimezoneCapture } from "../timezone-capture";
import type { WorkTransactionContext } from "../web-clock-out-transaction";
import type { WorkLocationType } from "../work-location";
import type { ClosedLiveWork } from "./follow-ups";
import type { ClockCommand, ClockOutResult } from "./types";

type Employee = typeof employee.$inferSelect;

/** One clock-out command, resolved against its subject. */
export type ClockOutPlan = {
	command: ClockCommand;
	employee: Employee;
	/** The receipt's frozen command; a retry must carry exactly the same value. */
	receiptCommand: CloseActiveWorkCommand;
	writer: CloseActiveWorkWriter;
};

export type ClockOutReplay = {
	result: ClockOutResult;
	durationMinutes: number | null;
};

/** A committed closure, before follow-ups. */
export type ClockOutClosure =
	| ({ disposition: "replayed" } & ClockOutReplay)
	| {
			disposition: "executed";
			entry: ClockOutResult;
			closed: Omit<ClosedLiveWork, "timezone">;
	  };

export function planClockOut(command: ClockCommand, employee: Employee): ClockOutPlan {
	const { body, identity, at, zone, channel } = command;
	return {
		command,
		employee,
		receiptCommand: {
			version: 1,
			operationId: identity.id,
			project: body.project,
			workCategory: body.workCategory,
			requestedInstant: at.kind === "occurred" ? instantToCanonicalString(at.instant) : null,
			browserTimezone: zone.device,
			deviceInfo: channel,
		},
		writer: liveClockOutWriter(channel),
	};
}

/** The original committed result; current approval state is a separate read. */
function receiptReplay(receipt: CloseActiveWorkReceipt): ClockOutReplay {
	const { approval } = receipt.result;
	return {
		result: {
			...(receipt.entry as ClockOutResult),
			pendingApproval:
				approval.participation === "policy_clock_out"
					? approval.outcome !== "auto_completed"
					: undefined,
		},
		durationMinutes: receipt.result.segment.durationMinutes,
	};
}

export function pendingApproval(submission: { result: { kind: string } } | null | undefined) {
	return submission ? submission.result.kind !== "auto_completed" : undefined;
}

function replayReceipt(coordination: WorkTransactionContext, plan: ClockOutPlan) {
	return replayCloseActiveWork(coordination, {
		organizationId: plan.employee.organizationId,
		employeeId: plan.employee.id,
		command: plan.receiptCommand,
		writer: plan.writer.writer,
	});
}

/** The receipt-less legacy row committed under this identity, if any. */
function findLegacyEvidence(coordination: WorkTransactionContext, plan: ClockOutPlan) {
	const { command, employee } = plan;
	return findPolicyClockOutSubmissionEvidence({
		tx: coordination.db,
		submissionId: command.identity.id,
		organizationId: employee.organizationId,
		employeeId: employee.id,
		projectId: attributionValue(command.body.project) ?? null,
		workCategoryId: attributionValue(command.body.workCategory) ?? null,
	});
}

/**
 * A receipt-less committed clock-out keeps its exact legacy matching rules,
 * including a historical policy clock-out's approval submission, which only replays.
 */
async function replayLegacyClockOut(
	coordination: WorkTransactionContext,
	plan: ClockOutPlan,
): Promise<ClockOutReplay | null> {
	const evidence = await findLegacyEvidence(coordination, plan);
	if (!evidence) return null;
	const { period, hasApprovalEvidence } = evidence;
	const approvalSubmission = hasApprovalEvidence
		? await replayPolicySubmission(coordination, plan, period.id)
		: null;
	return {
		result: {
			...(period.clockOut as ClockOutResult),
			pendingApproval: pendingApproval(approvalSubmission),
		},
		durationMinutes: period.durationMinutes ?? null,
	};
}

async function replayPolicySubmission(
	coordination: WorkTransactionContext,
	plan: ClockOutPlan,
	workPeriodId: string,
) {
	const { command, employee } = plan;
	const context = coordination.approval;
	return requireReplayOnlySubmission(
		await executeOrdinaryWorkPeriodSubmissionInTransaction({
			dbService: approvalDbServiceForTransaction(context.dbService),
			context,
			coordination,
			organizationId: employee.organizationId,
			workPeriodId,
			submissionId: command.identity.id,
			requesterEmployeeId: employee.id,
			requesterUserId: command.principal.userId,
			teamId: employee.teamId,
			defaultApproverId: null,
			reason: POLICY_CLOCK_OUT_APPROVAL_REASON,
			overtimeRisk: "warning",
			kind: "policy_clock_out",
			metadata: {},
		}),
	);
}

/**
 * The committed result for this identity, or null. Receipts precede the legacy
 * matcher in every admission, so a later admission rollback still replays
 * committed operations exactly.
 */
export async function replayClockOut(
	coordination: WorkTransactionContext,
	plan: ClockOutPlan,
): Promise<ClockOutReplay | null> {
	const receipt = await replayReceipt(coordination, plan);
	if (receipt) return receiptReplay(receipt);
	return replayLegacyClockOut(coordination, plan);
}

export type ClockOutTarget = {
	workPeriodId: string;
	start: Instant;
	workLocationType: WorkLocationType | null;
};

/**
 * Closes the target inside the work transaction, through the admission's writer.
 * Replayable identities re-check replay here, since a matching command may have
 * committed after the first replay read.
 */
export async function closeClockOut(
	coordination: WorkTransactionContext,
	input: {
		plan: ClockOutPlan;
		replayable: boolean;
		target: ClockOutTarget;
		eventInstant: Instant;
		capture: TimeEntryTimezoneCapture;
	},
): Promise<ClockOutClosure> {
	const { plan, replayable } = input;
	if (replayable) {
		const receipt = await replayReceipt(coordination, plan);
		if (receipt) return { disposition: "replayed", ...receiptReplay(receipt) };
	}
	if (coordination.admission !== "append") {
		return closeLegacyClockOut(coordination, input);
	}
	if (replayable) {
		const legacy = await replayLegacyClockOut(coordination, plan);
		if (legacy) return { disposition: "replayed", ...legacy };
	}
	const { employee, receiptCommand, writer } = plan;
	const closed = await closeActiveWork(coordination, {
		organizationId: employee.organizationId,
		employeeId: employee.id,
		teamId: employee.teamId,
		actorUserId: plan.command.principal.userId,
		workPeriodId: input.target.workPeriodId,
		command: receiptCommand,
		writer,
		eventInstant: input.eventInstant,
		capture: input.capture,
	});
	const { result } = closed;
	return {
		disposition: "executed",
		entry: closed.entry as ClockOutResult,
		closed: {
			organizationId: employee.organizationId,
			employeeId: employee.id,
			actorUserId: plan.command.principal.userId,
			workPeriodId: result.workPeriodId,
			start: parseInstant(result.segment.startAt),
			durationMinutes: result.segment.durationMinutes,
			projectId: result.attribution.projectId,
			surchargeSnapshot: closed.surchargeSnapshot,
			balanceRefreshCommitted: true,
		},
	};
}

/**
 * The #272 legacy closure: the hash-chained clock-out, the canonical work record
 * and the surcharge snapshot, all derived from the closer's locked start and
 * duration so both representations agree (#388).
 */
async function closeLegacyClockOut(
	coordination: WorkTransactionContext,
	input: {
		plan: ClockOutPlan;
		target: ClockOutTarget;
		eventInstant: Instant;
		capture: TimeEntryTimezoneCapture;
	},
): Promise<ClockOutClosure> {
	const { plan, target, eventInstant } = input;
	const { command, employee } = plan;
	const projectId = attributionValue(command.body.project);
	const workCategoryId = attributionValue(command.body.workCategory);
	const endTime = dateFromInstant(eventInstant);
	let surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null = null;
	const closed = await clockingService.clockOut({
		coordination,
		actionId: command.identity.id,
		employeeId: employee.id,
		organizationId: employee.organizationId,
		workPeriodId: target.workPeriodId,
		createdBy: command.principal.userId,
		action: { instant: eventInstant, ...input.capture },
		source: clockSource(command.channel),
		projectId,
		workCategoryId,
		approvalStatus: "approved",
		beforePeriodClose: async ({ activePeriod, durationMinutes }) => {
			surchargeSnapshot = await resolvePolicyClockOutSurchargeSnapshotInTransaction({
				dbService: { db: coordination.db },
				organizationId: employee.organizationId,
				employeeId: employee.id,
				startTime: instantFromDate(activePeriod.startTime),
				endTime: eventInstant,
			});
			const canonicalRecord = await canonicalWorkRecordClient.createForCompletedPeriod(
				{
					organizationId: employee.organizationId,
					employeeId: employee.id,
					startAt: activePeriod.startTime,
					endAt: endTime,
					durationMinutes,
					approvalState: "approved",
					createdBy: command.principal.userId,
					workCategoryId: workCategoryId ?? null,
					workLocationType: target.workLocationType,
					projectId: projectId ?? null,
					origin: "clock",
				},
				coordination.db,
			);
			return { canonicalRecordId: canonicalRecord.id, pendingChanges: null };
		},
	});
	if (closed.disposition === "replayed") {
		const evidence = await findLegacyEvidence(coordination, plan);
		if (!evidence || evidence.period.id !== closed.period.id) {
			throw new Error("Submission collision");
		}
		const approvalSubmission = evidence.hasApprovalEvidence
			? await replayPolicySubmission(coordination, plan, closed.period.id)
			: null;
		return {
			disposition: "replayed",
			result: {
				...(closed.entry as ClockOutResult),
				pendingApproval: pendingApproval(approvalSubmission),
			},
			durationMinutes: closed.durationMinutes,
		};
	}
	return {
		disposition: "executed",
		entry: closed.entry as ClockOutResult,
		closed: {
			organizationId: employee.organizationId,
			employeeId: employee.id,
			actorUserId: command.principal.userId,
			workPeriodId: target.workPeriodId,
			start: target.start,
			durationMinutes: closed.durationMinutes,
			projectId: projectId ?? null,
			// Assigned inside the closer's callback, which narrowing cannot see.
			surchargeSnapshot: surchargeSnapshot as PolicyClockOutSurchargeSnapshot | null,
			balanceRefreshCommitted: false,
		},
	};
}
