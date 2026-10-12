import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { completedWorkOperation, timeEntry, workPeriod } from "@/db/schema";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import { ClockingConflictError } from "../clocking-core";
import type { WorkTransactionClient } from "../web-clock-out-transaction";
import { assertNoUnresolvedWorkPeriodReview } from "../work-period-review";
import type { BreakCommand, BreakOutcome, BreakStart, ClockCommand } from "./types";

/**
 * A break in progress (#861, Time Tracking ADR 0007): a manual break that has
 * started and not ended, recorded on the employee's live work. Resuming sends
 * the break command with the recorded start; every closure of the live work
 * ends it at that start and clears it, so a break never counts as work. Until
 * then the interrupted work stays live and keeps counting.
 */

/** Starting or resuming a break in progress: the employee's own command, never on behalf. */
export type BreakInProgressCommand = Pick<
	ClockCommand,
	"organizationId" | "principal" | "subject" | "identity" | "channel" | "at" | "zone" | "freshness"
>;

/** A resume becomes a break command; it may carry that command's request evidence. */
export type ResumeBreakCommand = BreakInProgressCommand &
	Pick<BreakCommand, "request" | "position">;

export type StartBreakResult = {
	/** The live work the break interrupts. */
	workPeriodId: string;
	start: Instant;
};

export type StartBreakRefusal =
	| { code: "billing_required"; reason: string }
	| { code: "admission_window"; reason: "too_old" | "in_future" }
	| { code: "under_review"; review: "approval" | "time_correction" }
	| { code: "failed" | "unconfirmed"; cause?: unknown }
	| {
			code:
				| "access_denied"
				| "invalid_command"
				/** The identity started another employee's break. */
				| "collision"
				| "not_clocked_in"
				/** A break in progress is already open on the live work. */
				| "already_on_break"
				/** The break would start at or before the work. */
				| "invalid_interval";
	  };

export type StartBreakOutcome =
	| { outcome: "executed" | "replayed"; result: StartBreakResult }
	| { outcome: "refused"; failure: StartBreakRefusal };

export type ResumeBreakOutcome =
	| BreakOutcome
	| { outcome: "refused"; failure: { code: "no_break_in_progress" } };

type Reader = Pick<WorkTransactionClient, "select">;
type EmployeeScope = { organizationId: string; employeeId: string };
type PeriodScope = EmployeeScope & { workPeriodId: string };

/**
 * The break in progress a closure found has changed under the work
 * transaction's locks: the closure re-resolves its target. As a conflict it
 * reads as a changed target should it persist.
 */
export class BreakInProgressChangedError extends ClockingConflictError {
	constructor() {
		super("Break in progress changed");
	}
}

function breakStartOfRow(row: {
	breakStartedAt: Date | null;
	breakStartedZone: string | null;
}): BreakStart | null {
	return row.breakStartedAt && row.breakStartedZone
		? { instant: instantFromDate(row.breakStartedAt), zone: row.breakStartedZone }
		: null;
}

function sameBreak(a: BreakStart | null, b: BreakStart | null) {
	if (!a || !b) return a === b;
	return compareInstants(a.instant, b.instant) === 0 && a.zone === b.zone;
}

/** The employee's live work, with its break in progress if one is open. */
export async function findLiveWork(client: Reader, scope: EmployeeScope) {
	const [period] = await client
		.select({
			id: workPeriod.id,
			startTime: workPeriod.startTime,
			breakStartedAt: workPeriod.breakStartedAt,
			breakStartedZone: workPeriod.breakStartedZone,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
				eq(workPeriod.isActive, true),
				isNull(workPeriod.endTime),
				isNull(workPeriod.deletedAt),
			),
		)
		.limit(1);
	if (!period) return null;
	return {
		workPeriodId: period.id,
		start: instantFromDate(period.startTime),
		breakInProgress: breakStartOfRow(period),
	};
}

/** The break in progress of one period, or null. */
export async function readBreakInProgress(
	client: Reader,
	scope: PeriodScope,
): Promise<BreakStart | null> {
	const [period] = await client
		.select({
			breakStartedAt: workPeriod.breakStartedAt,
			breakStartedZone: workPeriod.breakStartedZone,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, scope.workPeriodId),
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
			),
		)
		.limit(1);
	return period ? breakStartOfRow(period) : null;
}

/**
 * Where a closure of live work ends: at the open break's start when that
 * precedes the closure's own instant, so the break never counts as work.
 */
export function closureEnd(eventInstant: Instant, open: BreakStart | null) {
	if (open && compareInstants(open.instant, eventInstant) < 0) {
		return { instant: open.instant, zone: open.zone, atBreakStart: true } as const;
	}
	return { instant: eventInstant, zone: null, atBreakStart: false } as const;
}

/** Whether a break command resumes the open break: it closes the work at exactly its start. */
export function resumesBreak(command: BreakCommand, open: BreakStart) {
	const { start } = command.body;
	return start !== undefined && compareInstants(start.instant, open.instant) === 0;
}

/**
 * Inside a closure's work transaction, after the closure wrote: the closed
 * period's break in progress must still be the one the closure was planned
 * against (a start committed in between re-plans it), and is then cleared.
 */
export async function settleBreakInProgress(
	tx: WorkTransactionClient,
	scope: PeriodScope,
	planned: BreakStart | null,
) {
	const current = await readBreakInProgress(tx, scope);
	if (!sameBreak(current, planned)) throw new BreakInProgressChangedError();
	if (!planned) return;
	await tx
		.update(workPeriod)
		.set({ breakStartedAt: null, breakStartedZone: null })
		.where(
			and(
				eq(workPeriod.id, scope.workPeriodId),
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
			),
		);
}

/**
 * The break a committed start operation recorded, for its replay. Once the work
 * has closed, the recorded start is cleared and the closed work's end stands
 * for it.
 */
async function findStartedBreak(
	client: Reader,
	scope: EmployeeScope,
	operationId: string,
): Promise<StartBreakResult | null> {
	const [period] = await client
		.select({
			id: workPeriod.id,
			employeeId: workPeriod.employeeId,
			endTime: workPeriod.endTime,
			breakStartedAt: workPeriod.breakStartedAt,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.breakStartedOperationId, operationId),
			),
		)
		.limit(1);
	if (!period) return null;
	const start = period.breakStartedAt ?? period.endTime;
	// Another employee's operation, or a row no closure would leave, is not this command.
	if (period.employeeId !== scope.employeeId || !start) throw new BreakStartCollisionError();
	return { workPeriodId: period.id, start: instantFromDate(start) };
}

/** The start's identity names another command. */
export class BreakStartCollisionError extends Error {
	constructor() {
		super("Break start identity collision");
	}
}

export type BreakStartWrite =
	| { disposition: "executed" | "replayed"; result: StartBreakResult }
	| { disposition: "refused"; code: "not_clocked_in" | "already_on_break" | "invalid_interval" };

/** A committed start under this identity, read without the work transaction. */
export function replayBreakStart(client: Reader, scope: EmployeeScope, operationId: string) {
	return findStartedBreak(client, scope, operationId);
}

/**
 * Records the break in progress on the live work, inside the work transaction
 * that holds the period's lock. Replayable identities re-check replay first.
 * Work under review is refused by throwing, as a break is (both admissions).
 */
export async function recordBreakInProgress(
	tx: WorkTransactionClient,
	input: PeriodScope & {
		operationId: string;
		replayable: boolean;
		start: BreakStart;
	},
): Promise<BreakStartWrite> {
	if (input.replayable) {
		const replay = await findStartedBreak(tx, input, input.operationId);
		if (replay) return { disposition: "replayed", result: replay };
	}
	const [period] = await tx
		.select({
			id: workPeriod.id,
			approvalStatus: workPeriod.approvalStatus,
			startTime: workPeriod.startTime,
			breakStartedAt: workPeriod.breakStartedAt,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.isActive, true),
				isNull(workPeriod.endTime),
				isNull(workPeriod.deletedAt),
			),
		)
		.limit(1);
	if (!period) return { disposition: "refused", code: "not_clocked_in" };
	if (period.breakStartedAt) return { disposition: "refused", code: "already_on_break" };
	if (compareInstants(input.start.instant, instantFromDate(period.startTime)) <= 0) {
		return { disposition: "refused", code: "invalid_interval" };
	}
	await assertNoUnresolvedWorkPeriodReview(tx, input.organizationId, period);
	const [recorded] = await tx
		.update(workPeriod)
		.set({
			breakStartedAt: dateFromInstant(input.start.instant),
			breakStartedZone: input.start.zone,
			breakStartedOperationId: input.operationId,
		})
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				isNull(workPeriod.endTime),
				isNull(workPeriod.breakStartedAt),
			),
		)
		.returning({ id: workPeriod.id });
	if (!recorded) throw new ClockingConflictError("Active work period changed");
	return {
		disposition: "executed",
		result: { workPeriodId: recorded.id, start: input.start.instant },
	};
}

/**
 * The break start a committed resume under this identity closed the work at,
 * so its retry rebuilds the same break command and replays. The append writer's
 * receipt keeps the command; the legacy writer's resumed clock-in takes the
 * identity and follows the break's clock-out.
 */
export async function committedResumeStart(
	client: Reader,
	scope: EmployeeScope,
	operationId: string,
): Promise<BreakStart | null> {
	const [receipt] = await client
		.select({ kind: completedWorkOperation.kind, command: completedWorkOperation.command })
		.from(completedWorkOperation)
		.where(
			and(
				eq(completedWorkOperation.id, operationId),
				eq(completedWorkOperation.organizationId, scope.organizationId),
				eq(completedWorkOperation.employeeId, scope.employeeId),
			),
		)
		.limit(1);
	if (receipt) {
		const start = (receipt.command as { breakStart?: { at?: unknown; timezone?: unknown } })
			.breakStart;
		if (
			receipt.kind !== "close_resume_work" ||
			typeof start?.at !== "string" ||
			typeof start.timezone !== "string"
		) {
			return null;
		}
		return { instant: parseInstant(start.at), zone: start.timezone };
	}
	const entryScope = and(
		eq(timeEntry.organizationId, scope.organizationId),
		eq(timeEntry.employeeId, scope.employeeId),
	);
	const [resumed] = await client
		.select({ type: timeEntry.type, previousEntryId: timeEntry.previousEntryId })
		.from(timeEntry)
		.where(and(eq(timeEntry.id, operationId), entryScope))
		.limit(1);
	if (resumed?.type !== "clock_in" || !resumed.previousEntryId) return null;
	const [closed] = await client
		.select({ type: timeEntry.type, timestamp: timeEntry.timestamp, timezone: timeEntry.timezone })
		.from(timeEntry)
		.where(and(eq(timeEntry.id, resumed.previousEntryId), entryScope))
		.limit(1);
	if (closed?.type !== "clock_out" || !closed.timezone) return null;
	return { instant: instantFromDate(closed.timestamp), zone: closed.timezone };
}

/** The freshness window over a start's own instant, as a clock command's. */
export function startFreshnessRefusal(command: BreakInProgressCommand, instant: Instant) {
	const { freshness } = command;
	if (!freshness || command.at.kind !== "occurred") return null;
	for (const observed of [instant, ...(freshness.observed ?? [])]) {
		if (compareInstants(observed, freshness.earliest) < 0) {
			return { code: "admission_window" as const, reason: "too_old" as const };
		}
		if (compareInstants(observed, freshness.latest) > 0) {
			return { code: "admission_window" as const, reason: "in_future" as const };
		}
	}
	return null;
}
