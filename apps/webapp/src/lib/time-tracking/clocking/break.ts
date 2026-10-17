import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { type employee, timeEntry, workPeriod } from "@/db/schema";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import {
	ClockingConflictError,
	createDatabaseClockingStore,
	insertChainedClockIn,
	LiveWorkOccupiedError,
} from "../clocking-core";
import {
	type CloseActiveWorkWriter,
	type ClosingVehicleUse,
	CompletedWorkCollisionError,
	closeActiveWorkGraph,
} from "../close-active-work";
import {
	type CloseResumeWorkOperationCommand,
	type CloseResumeWorkResult,
	closeAndResumeWork,
	replayCloseResumeWork,
} from "../close-resume-work";
import { sendBackChangedPeriodSubmissions } from "../period-submissions/submission-send-back";
import { findLiveWorkOccupant } from "../start-live-work";
import type { TimeEntryTimezoneCapture } from "../timezone-capture";
import type { WorkTransactionContext } from "../web-clock-out-transaction";
import type { WorkLocationType } from "../work-location";
import { assertNoUnresolvedWorkPeriodReview } from "../work-period-review";
import type { ClockOutTarget } from "./clock-out";
import type { ClosedLiveWork } from "./follow-ups";
import {
	assertFrozenAccepted,
	assertFrozenIdentityUnused,
	isFrozen,
	receiptCommandOf,
} from "./frozen";
import { clockWriterOf, kioskReceiptEvidence } from "./kiosk";
import { assertLegacyAccepted } from "./legacy-command";
import {
	type BreakCommand,
	type BreakResult,
	principalCausingUserId,
	type TimeEntryRequestMetadata,
} from "./types";

type Employee = typeof employee.$inferSelect;

const BREAK_COMMAND_VERSION = 1;

/** The receipt's frozen command; a retry must carry exactly the same value. */
export type BreakReceiptCommand = CloseResumeWorkOperationCommand & {
	version: typeof BREAK_COMMAND_VERSION;
	/** Device-captured resume instant; absent when the server sampled it. */
	requestedInstant?: string;
	browserTimezone: string | null;
	deviceInfo: BreakCommand["channel"];
} & ({ breakMinutes: number } | { breakStart: { at: string; timezone: string } });

/** One break command, resolved against its subject. */
export type BreakPlan = {
	command: BreakCommand;
	employee: Employee;
	/** The receipt's command: the frozen payload, or the established live command. */
	receiptCommand: CloseResumeWorkOperationCommand;
	writer: CloseActiveWorkWriter;
};

/** Where the break closes the work it resumes at `resumeAt`. */
export function breakStartOf(command: BreakCommand, resumeAt: Instant): Instant {
	const { body } = command;
	return body.start ? body.start.instant : resumeAt.subtract({ minutes: body.breakMinutes });
}

/** The two endpoints of a break: where the work closes and where it resumes. */
export type BreakEndpoints = {
	close: { instant: Instant; capture: TimeEntryTimezoneCapture };
	resume: { instant: Instant; capture: TimeEntryTimezoneCapture };
};

/** A committed break, before follow-ups. */
export type BreakClosure =
	| { disposition: "replayed"; result: BreakResult }
	| {
			disposition: "executed";
			result: BreakResult;
			closed: Omit<ClosedLiveWork, "timezone">;
			/** The resumed clock-in entry: the break's end, where its position stamp belongs. */
			resumeEntryId: string;
	  };

export function planBreak(command: BreakCommand, employee: Employee): BreakPlan {
	const { body, identity, at, zone, channel } = command;
	const receiptCommand: BreakReceiptCommand = {
		version: BREAK_COMMAND_VERSION,
		operationId: identity.id,
		...(body.start
			? {
					breakStart: {
						at: instantToCanonicalString(body.start.instant),
						timezone: body.start.zone,
					},
				}
			: { breakMinutes: body.breakMinutes }),
		// Server-sampled breaks keep the established web receipt command.
		...(at.kind === "occurred" ? { requestedInstant: instantToCanonicalString(at.instant) } : {}),
		browserTimezone: zone.device,
		deviceInfo: channel,
		...kioskReceiptEvidence(command),
	};
	return {
		command,
		employee,
		receiptCommand: receiptCommandOf<CloseResumeWorkOperationCommand>(command, receiptCommand),
		// The live channel's writer names the channel, not the kind; a kiosk's also
		// names the kiosk (#860).
		writer: clockWriterOf(command),
	};
}

function receiptResult(result: CloseResumeWorkResult): BreakResult {
	return {
		workPeriodId: result.resume.workPeriodId,
		start: parseInstant(result.resume.start.at),
	};
}

function replayReceipt(coordination: WorkTransactionContext, plan: BreakPlan) {
	return replayCloseResumeWork(coordination, {
		organizationId: plan.employee.organizationId,
		employeeId: plan.employee.id,
		command: plan.receiptCommand,
		writer: plan.writer.writer,
	});
}

/**
 * A receipt-less break committed under this identity by the legacy writer, whose
 * resumed clock-in entry takes the operation ID and follows the break's own
 * clock-out entry at exactly the break's start. Any other entry of the employee
 * under the ID is a collision. The reads stay in the organization.
 */
async function replayLegacyBreak(
	coordination: WorkTransactionContext,
	plan: BreakPlan,
): Promise<BreakResult | null> {
	const { command, employee } = plan;
	const scope = and(
		eq(timeEntry.organizationId, employee.organizationId),
		eq(timeEntry.employeeId, employee.id),
	);
	const [resumed] = await coordination.db
		.select()
		.from(timeEntry)
		.where(and(eq(timeEntry.id, command.identity.id), scope))
		.limit(1);
	if (!resumed) return null;
	const [closedEntry] = resumed.previousEntryId
		? await coordination.db
				.select({ type: timeEntry.type, timestamp: timeEntry.timestamp })
				.from(timeEntry)
				.where(and(eq(timeEntry.id, resumed.previousEntryId), scope))
				.limit(1)
		: [];
	const [period] = await coordination.db
		.select({ id: workPeriod.id })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, employee.organizationId),
				eq(workPeriod.employeeId, employee.id),
				eq(workPeriod.clockInId, resumed.id),
				isNull(workPeriod.deletedAt),
			),
		)
		.limit(1);
	const resumedAt = instantFromDate(resumed.timestamp);
	const { at } = command;
	if (
		resumed.type !== "clock_in" ||
		resumed.isSuperseded ||
		closedEntry?.type !== "clock_out" ||
		compareInstants(instantFromDate(closedEntry.timestamp), breakStartOf(command, resumedAt)) !==
			0 ||
		(at.kind === "occurred" && compareInstants(resumedAt, at.instant) !== 0) ||
		!period
	) {
		throw new CompletedWorkCollisionError();
	}
	return { workPeriodId: period.id, start: resumedAt };
}

/**
 * The committed break for this identity, or null. Receipts precede the legacy
 * matcher in every admission, so a later admission change still replays exactly.
 * A frozen break commits only with its receipt.
 */
export async function replayBreak(
	coordination: WorkTransactionContext,
	plan: BreakPlan,
): Promise<BreakResult | null> {
	const receipt = await replayReceipt(coordination, plan);
	if (receipt) return receiptResult(receipt.result);
	if (isFrozen(plan.command)) {
		await assertFrozenIdentityUnused(coordination.db, plan.command);
		return null;
	}
	return replayLegacyBreak(coordination, plan);
}

/**
 * Closes the target at the break start and resumes it at the command's instant,
 * inside the work transaction, through the admission's writer. Replayable
 * identities re-check replay first, since a matching command may have committed
 * after the first replay read. Both admissions refuse work under review and an
 * occupied resumed interval.
 */
export async function takeBreak(
	coordination: WorkTransactionContext,
	input: {
		plan: BreakPlan;
		replayable: boolean;
		target: ClockOutTarget;
		endpoints: BreakEndpoints;
		/** The closed work's vehicle use, decided from the live work's (#1122). */
		closingVehicleUse?: ClosingVehicleUse;
		/** The source evidence of the entry at the break's start; the writer's by default (#885). */
		closeEntrySource?: { ipAddress: string | null; deviceInfo: string };
	},
): Promise<BreakClosure> {
	const { plan, target, endpoints } = input;
	if (input.replayable) {
		const replay = await replayBreak(coordination, plan);
		if (replay) return { disposition: "replayed", result: replay };
	}
	assertFrozenAccepted(input.plan.command, coordination.admission);
	assertLegacyAccepted(input.plan.command, coordination.admission);
	if (coordination.admission !== "append") {
		return takeLegacyBreak(coordination, input);
	}
	const { command, employee, receiptCommand, writer } = plan;
	const executed = await closeAndResumeWork(coordination, {
		organizationId: employee.organizationId,
		employeeId: employee.id,
		teamId: employee.teamId,
		actorUserId: command.principal.userId,
		workPeriodId: target.workPeriodId,
		command: receiptCommand,
		writer,
		close: endpoints.close,
		resume: endpoints.resume,
		...(input.closingVehicleUse ? { closingVehicleUse: input.closingVehicleUse } : {}),
		...(input.closeEntrySource ? { closeEntrySource: input.closeEntrySource } : {}),
	});
	const { close } = executed.result;
	return {
		disposition: "executed",
		result: receiptResult(executed.result),
		resumeEntryId: executed.result.resume.clockInEntryId,
		closed: {
			organizationId: employee.organizationId,
			employeeId: employee.id,
			actorUserId: command.principal.userId,
			workPeriodId: close.workPeriodId,
			start: parseInstant(close.segment.startAt),
			end: parseInstant(close.segment.endAt),
			durationMinutes: close.segment.durationMinutes,
			projectId: close.attribution.projectId,
			surchargeSnapshot: executed.closed.surchargeSnapshot,
			balanceRefreshCommitted: true,
		},
	};
}

/** The writer's source evidence, for a break whose adapter carries no request. */
function writerRequestMetadata(writer: CloseActiveWorkWriter): TimeEntryRequestMetadata {
	return { ipAddress: writer.ipAddress ?? null, userAgent: writer.deviceInfo };
}

/**
 * The established break of organizations that have not adopted: work records
 * creates the completed work up to the break start from the live work (#1222),
 * then the resumed clock-in entry, chained right after the break's clock-out,
 * and a resumed period in the target's location start live work again. The
 * resumed clock-in entry takes the operation ID, which is what the legacy replay
 * matches; both entries record the request's source evidence.
 */
async function takeLegacyBreak(
	coordination: WorkTransactionContext,
	input: {
		plan: BreakPlan;
		target: ClockOutTarget;
		endpoints: BreakEndpoints;
		closingVehicleUse?: ClosingVehicleUse;
	},
): Promise<BreakClosure> {
	const { plan, target, endpoints } = input;
	const { command, employee } = plan;
	const organizationId = employee.organizationId;
	const employeeId = employee.id;
	const actorUserId = command.principal.userId;
	coordination.assertEmployee(organizationId, employeeId);
	const tx = coordination.db;
	const [period] = await tx
		.select({
			id: workPeriod.id,
			approvalStatus: workPeriod.approvalStatus,
			workLocationType: workPeriod.workLocationType,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, target.workPeriodId),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.isActive, true),
			),
		)
		.limit(1);
	if (!period) throw new ClockingConflictError("Active work period changed");
	await assertNoUnresolvedWorkPeriodReview(tx, organizationId, period);
	const request = command.request ?? writerRequestMetadata(plan.writer);

	const closed = await closeActiveWorkGraph(
		coordination,
		{
			organizationId,
			employeeId,
			teamId: employee.teamId,
			actorUserId,
			workPeriodId: target.workPeriodId,
			// A break changes no attribution of the work it closes.
			command: {
				version: BREAK_COMMAND_VERSION,
				operationId: command.identity.id,
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			},
			writer: plan.writer,
			eventInstant: endpoints.close.instant,
			capture: endpoints.close.capture,
			entrySource: { ipAddress: request.ipAddress, deviceInfo: request.userAgent },
			...(input.closingVehicleUse ? { closingVehicleUse: input.closingVehicleUse } : {}),
		},
		// The break's clock-out gets a fresh server identity.
		randomUUID(),
		{ identityChecked: true },
	);
	const { segment, attribution } = closed.result;

	// Occupancy of the resumed interval, after the closure so the closed target no
	// longer occupies it and any other work still does. Throwing rolls back.
	const occupant = await findLiveWorkOccupant(
		tx,
		{ organizationId, employeeId },
		dateFromInstant(endpoints.resume.instant),
	);
	if (occupant) throw new LiveWorkOccupiedError(occupant);

	// The resumed work is live work, which Clocking starts (Time Tracking ADR 0010).
	const store = createDatabaseClockingStore(tx);
	const clockInEntry = await insertChainedClockIn(
		store,
		{
			employeeId,
			organizationId,
			createdBy: actorUserId,
			actionId: command.identity.id,
			action: { instant: endpoints.resume.instant, ...endpoints.resume.capture },
			source: { ipAddress: request.ipAddress, deviceInfo: request.userAgent },
		},
		// Entries written in one transaction share their creation time: chain explicitly.
		{ id: closed.entry.id, hash: (closed.entry as typeof timeEntry.$inferSelect).hash },
	);
	const resumedPeriod = await store.insertActivePeriod({
		employeeId,
		organizationId,
		clockInId: clockInEntry.id,
		startTime: dateFromInstant(endpoints.resume.instant),
		workLocationType: period.workLocationType ?? ("office" satisfies WorkLocationType),
	});
	// The resumed start sends a submitted period back (#805); the closed work did already.
	await sendBackChangedPeriodSubmissions(tx, {
		organizationId,
		employeeId,
		causedByUserId: principalCausingUserId(command.principal),
		work: [{ start: endpoints.resume.instant, end: endpoints.resume.instant }],
	});

	return {
		disposition: "executed",
		result: { workPeriodId: resumedPeriod.id, start: endpoints.resume.instant },
		resumeEntryId: clockInEntry.id,
		closed: {
			organizationId,
			employeeId,
			actorUserId,
			workPeriodId: target.workPeriodId,
			start: parseInstant(segment.startAt),
			end: parseInstant(segment.endAt),
			durationMinutes: segment.durationMinutes,
			projectId: attribution.projectId,
			surchargeSnapshot: closed.surchargeSnapshot,
			balanceRefreshCommitted: true,
		},
	};
}
