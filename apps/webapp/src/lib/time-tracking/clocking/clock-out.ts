import "server-only";

import { and, eq } from "drizzle-orm";
import { type employee, workPeriod } from "@/db/schema";
import { executeOrdinaryWorkPeriodSubmissionInTransaction } from "@/lib/approvals/server/work-period-submission";
import { POLICY_CLOCK_OUT_APPROVAL_REASON } from "@/lib/approvals/time-request-kind";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import { canonicalWorkRecordClient } from "../canonical-work-record";
import { createClockingService, createDatabaseClockingStore } from "../clocking-core";
import { clockingService } from "../clocking-service";
import {
	type AttributionIntent,
	AUTOMATIC_CLOCK_OUT_WRITER,
	attributionValue,
	type CloseActiveWorkCommand,
	type CloseActiveWorkOperationCommand,
	type CloseActiveWorkReceipt,
	type CloseActiveWorkResult,
	type CloseActiveWorkWriter,
	CompletedWorkCollisionError,
	closeActiveWork,
	DEPARTURE_CLOCK_OUT_WRITER,
	liveClockOutWriter,
	MANAGER_ON_BEHALF_WRITER,
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
import { resolveWorkBillabilityInTransaction } from "../work-billability";
import type { WorkLocationType } from "../work-location";
import type { ClosedLiveWork } from "./follow-ups";
import {
	assertFrozenAccepted,
	assertFrozenIdentityUnused,
	isFrozen,
	receiptCommandOf,
} from "./frozen";
import { assertLegacyAccepted } from "./legacy-command";
import type { ClockOutCommand, ClockOutResult } from "./types";

type Employee = typeof employee.$inferSelect;

/** One clock-out command, resolved against its subject. */
export type ClockOutPlan = {
	command: ClockOutCommand;
	employee: Employee;
	/**
	 * The receipt's command: the frozen payload, or the established live command.
	 * A retry must carry exactly the same value.
	 */
	receiptCommand: CloseActiveWorkOperationCommand;
	writer: CloseActiveWorkWriter;
};

export type ClockOutReplay = {
	result: ClockOutResult;
	durationMinutes: number | null;
	/** Null for a legacy closure, which keeps no receipt. */
	receipt: CloseActiveWorkResult | null;
};

/** A committed closure, before follow-ups. */
export type ClockOutClosure =
	| ({ disposition: "replayed" } & ClockOutReplay)
	| {
			disposition: "executed";
			entry: ClockOutResult;
			closed: Omit<ClosedLiveWork, "timezone">;
			receipt: CloseActiveWorkResult | null;
	  };

/**
 * The receipt command of an on-behalf clock-out (#276). `server` identities
 * commit the same graph but cannot prove that a later retry is the same request.
 */
export type OnBehalfClockOutCommand = CloseActiveWorkOperationCommand & {
	version: 1;
	identity: "client" | "server";
	workPeriodId: string;
};

/**
 * A chosen billability joins the receipt command (#900); an absent one leaves the
 * command exactly as it was before billability, so earlier retries still replay.
 */
function billableOf(body: ClockOutCommand["body"]): { billable?: boolean } {
	return body.billable === undefined ? {} : { billable: body.billable };
}

function planOnBehalfClockOut(command: ClockOutCommand, employee: Employee): ClockOutPlan {
	const { body, identity } = command;
	// Authorization admits on-behalf closures of a named period only.
	if (body.target?.kind !== "period") throw new Error("On-behalf clock-out names no period");
	const receiptCommand: OnBehalfClockOutCommand = {
		version: 1,
		operationId: identity.id,
		identity: identity.origin === "server" ? "server" : "client",
		workPeriodId: body.target.workPeriodId,
		project: body.project,
		workCategory: body.workCategory,
		...billableOf(body),
	};
	return { command, employee, receiptCommand, writer: MANAGER_ON_BEHALF_WRITER };
}

/**
 * The receipt command of a departure's clock-out (#485): the departure closes one
 * named period, so a retry of the same departure is the same command.
 */
export type DepartureClockOutCommand = CloseActiveWorkOperationCommand & {
	version: 1;
	departureId: string;
	workPeriodId: string;
};

function planDepartureClockOut(
	command: ClockOutCommand,
	employee: Employee,
	departureId: string,
): ClockOutPlan {
	const { body, identity } = command;
	// The module admits departure closures of a named period only.
	if (body.target?.kind !== "period") throw new Error("Departure clock-out names no period");
	const receiptCommand: DepartureClockOutCommand = {
		version: 1,
		operationId: identity.id,
		departureId,
		workPeriodId: body.target.workPeriodId,
		project: body.project,
		workCategory: body.workCategory,
		...billableOf(body),
	};
	return { command, employee, receiptCommand, writer: DEPARTURE_CLOCK_OUT_WRITER };
}

export function planClockOut(command: ClockOutCommand, employee: Employee): ClockOutPlan {
	const { principal } = command;
	if (principal.kind === "automatic_clock_out") {
		if (command.body.target?.kind !== "period" || command.at.kind !== "occurred") {
			throw new Error("Automatic clock-out names no period or cutoff");
		}
		const receiptCommand = {
			version: 1,
			operationId: command.identity.id,
			workPeriodId: command.body.target.workPeriodId,
			requestedInstant: instantToCanonicalString(command.at.instant),
			timezone: command.zone.fallback,
			project: command.body.project,
			workCategory: command.body.workCategory,
			...billableOf(command.body),
		};
		return {
			command,
			employee,
			receiptCommand,
			writer: AUTOMATIC_CLOCK_OUT_WRITER,
		};
	}
	if (principal.kind === "departure") {
		return planDepartureClockOut(command, employee, principal.departureId);
	}
	if (command.subject.onBehalf) return planOnBehalfClockOut(command, employee);
	const { body, identity, at, zone, channel } = command;
	const receiptCommand: CloseActiveWorkCommand = {
		version: 1,
		operationId: identity.id,
		project: body.project,
		workCategory: body.workCategory,
		...billableOf(body),
		requestedInstant: at.kind === "occurred" ? instantToCanonicalString(at.instant) : null,
		browserTimezone: zone.device,
		deviceInfo: channel,
	};
	return {
		command,
		employee,
		receiptCommand: receiptCommandOf<CloseActiveWorkOperationCommand>(command, receiptCommand),
		writer: liveClockOutWriter(channel),
	};
}

/**
 * The original committed result; current approval state is a separate read. The
 * same identity from another principal is not this command.
 */
function receiptReplay(plan: ClockOutPlan, receipt: CloseActiveWorkReceipt): ClockOutReplay {
	const actor = receipt.result.actors.completing;
	const principal = plan.command.principal;
	if (
		principal.kind === "automatic_clock_out"
			? actor.kind !== "system" || actor.process !== "automatic_clock_out"
			: actor.kind !== "human" || actor.userId !== principal.userId
	) {
		throw new CompletedWorkCollisionError();
	}
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
		receipt: receipt.result,
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

/**
 * The receipt-less legacy row committed under this identity, if any. A preserving
 * intent matches whatever the closure kept; the principal must be the one who
 * completed it.
 */
async function findLegacyEvidence(coordination: WorkTransactionContext, plan: ClockOutPlan) {
	const { command, employee } = plan;
	const evidence = await findPolicyClockOutSubmissionEvidence({
		tx: coordination.db,
		submissionId: command.identity.id,
		organizationId: employee.organizationId,
		employeeId: employee.id,
		projectId: attributionValue(command.body.project),
		workCategoryId: attributionValue(command.body.workCategory),
	});
	if (evidence && evidence.period.clockOut?.createdBy !== command.principal.userId) {
		throw new CompletedWorkCollisionError();
	}
	return evidence;
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
		receipt: null,
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
	if (receipt) return receiptReplay(plan, receipt);
	if (isFrozen(plan.command)) {
		await assertFrozenIdentityUnused(coordination.db, plan.command);
		return null;
	}
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
		if (receipt) return { disposition: "replayed", ...receiptReplay(plan, receipt) };
	}
	assertFrozenAccepted(plan.command, coordination.admission);
	if (coordination.admission !== "append") {
		return closeLegacyClockOut(coordination, input);
	}
	if (isFrozen(plan.command)) {
		await assertFrozenIdentityUnused(coordination.db, plan.command);
	} else if (replayable) {
		const legacy = await replayLegacyClockOut(coordination, plan);
		if (legacy) return { disposition: "replayed", ...legacy };
	}
	assertLegacyAccepted(plan.command, coordination.admission);
	const { employee, receiptCommand, writer } = plan;
	const closed = await closeActiveWork(coordination, {
		organizationId: employee.organizationId,
		employeeId: employee.id,
		teamId: employee.teamId,
		actorUserId: plan.command.principal.userId,
		completingActor: completingActor(plan.command),
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
			completingActor: completingActor(plan.command),
			workPeriodId: result.workPeriodId,
			start: parseInstant(result.segment.startAt),
			end: parseInstant(result.segment.endAt),
			durationMinutes: result.segment.durationMinutes,
			projectId: result.attribution.projectId,
			surchargeSnapshot: closed.surchargeSnapshot,
			balanceRefreshCommitted: true,
		},
		receipt: result,
	};
}

/** The attribution a legacy closure keeps: a preserving intent keeps the period's value. */
async function legacyAttribution(
	coordination: WorkTransactionContext,
	plan: ClockOutPlan,
	workPeriodId: string,
) {
	const { command, employee } = plan;
	const [period] = await coordination.db
		.select({
			projectId: workPeriod.projectId,
			isBillable: workPeriod.isBillable,
			workCategoryId: workPeriod.workCategoryId,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, workPeriodId),
				eq(workPeriod.organizationId, employee.organizationId),
				eq(workPeriod.employeeId, employee.id),
			),
		)
		.limit(1);
	const kept = (intent: AttributionIntent, current: string | null | undefined) => {
		const value = attributionValue(intent);
		return value === undefined ? (current ?? null) : value;
	};
	const projectId = kept(command.body.project, period?.projectId);
	// The append writer's rule (#900): a changed project takes its billable default.
	const isBillable = await resolveWorkBillabilityInTransaction(
		coordination.db,
		employee.organizationId,
		{
			projectId,
			projectChosen: projectId !== (period?.projectId ?? null),
			current: period?.isBillable ?? false,
			requested: command.body.billable,
		},
	);
	return {
		projectId,
		isBillable,
		workCategoryId: kept(command.body.workCategory, period?.workCategoryId),
	};
}

/**
 * The legacy closer for trusted enlisted closures. It may end already-live work
 * after access ends, and runs only inside the enclosing work transaction.
 */
const enlistedLegacyClocking = createClockingService({
	transaction: () => {
		throw new Error("An enlisted clock-out runs in its enclosing work transaction");
	},
	storeForCoordinatedTransaction: (scope) => createDatabaseClockingStore(scope.db),
});

/**
 * The #272 legacy closure: the hash-chained clock-out, the canonical work record
 * and the surcharge snapshot, all derived from the closer's locked start and
 * duration so both representations agree (#388). Every legacy closure writes the
 * canonical record, on-behalf ones included (#476 decision 10).
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
	const { command, employee, writer } = plan;
	// Read under the coordinator's period lock, as the append writer resolves it.
	const { projectId, isBillable, workCategoryId } = await legacyAttribution(
		coordination,
		plan,
		target.workPeriodId,
	);
	const endTime = dateFromInstant(eventInstant);
	let surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null = null;
	const closer = command.principal.kind !== "user" ? enlistedLegacyClocking : clockingService;
	const closed = await closer.clockOut({
		coordination,
		actionId: command.identity.id,
		employeeId: employee.id,
		organizationId: employee.organizationId,
		workPeriodId: target.workPeriodId,
		createdBy: command.principal.userId,
		action: { instant: eventInstant, ...input.capture },
		source: { ipAddress: writer.ipAddress ?? null, deviceInfo: writer.deviceInfo },
		projectId,
		isBillable,
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
					workCategoryId,
					workLocationType: target.workLocationType,
					projectId,
					isBillable,
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
			receipt: null,
		};
	}
	return {
		disposition: "executed",
		entry: closed.entry as ClockOutResult,
		closed: {
			organizationId: employee.organizationId,
			employeeId: employee.id,
			actorUserId: command.principal.userId,
			completingActor: completingActor(command),
			workPeriodId: target.workPeriodId,
			start: target.start,
			end: eventInstant,
			durationMinutes: closed.durationMinutes,
			projectId,
			// Assigned inside the closer's callback, which narrowing cannot see.
			surchargeSnapshot: surchargeSnapshot as PolicyClockOutSurchargeSnapshot | null,
			balanceRefreshCommitted: false,
		},
		receipt: null,
	};
}

function completingActor(command: ClockOutCommand) {
	return command.principal.kind === "automatic_clock_out"
		? { kind: "system" as const, process: "automatic_clock_out" as const }
		: undefined;
}
