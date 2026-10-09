import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { completedWorkOperation, type employee, timeEntry, workPeriod } from "@/db/schema";
import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard";
import {
	type Clock,
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import {
	ClockingAccessError,
	ClockingConflictError,
	ClockingOrganizationError,
	LiveWorkOccupiedError,
} from "../clocking-core";
import {
	attributionValue,
	type CloseActiveWorkResult,
	CompletedWorkAttributionError,
	CompletedWorkCollisionError,
	CompletedWorkIntegrityError,
	findStandingClosure,
	liveClockOutWriter,
} from "../close-active-work";
import { type CloseResumeWorkResult, isCloseResumeStanding } from "../close-resume-work";
import { isProjectEligible, projectTaskIneligibility } from "../project-eligibility";
import { findStandingStart, type StartLiveWorkResult } from "../start-live-work";
import { attributionAfter } from "../task-attribution";
import { TimeEntryAppendReviewRequiredError } from "../time-entry-append";
import {
	resolveFallbackTimezoneCapture,
	resolveTimeEntryTimezoneCapture,
} from "../timezone-capture";
import { validateTimeEntry } from "../validation";
import { workCategoryIneligibility } from "../work-category-eligibility";
import { WorkIntervalError } from "../work-duration";
import { isWorkLocationType, type WorkLocationType } from "../work-location";
import { isUnresolvedWorkPeriodReview } from "../work-period-review";
import { authorizedSubject } from "./authorize";
import {
	type BreakClosure,
	type BreakPlan,
	breakStartOf,
	planBreak,
	replayBreak,
	takeBreak,
} from "./break";
import {
	type ClockInPlan,
	type ClockInStart,
	planClockIn,
	replayClockIn,
	startClockIn,
} from "./clock-in";
import {
	type ClockOutClosure,
	type ClockOutPlan,
	type ClockOutTarget,
	closeClockOut,
	planClockOut,
	replayClockOut,
} from "./clock-out";
import type { ClockFollowUps, ClockOutAdvice, ClosedLiveWork } from "./follow-ups";
import { FrozenCommandNotAcceptedError } from "./frozen";
import { LegacyCommandNotAcceptedError } from "./legacy-command";
import type { ClockTransactions } from "./transactions";
import type {
	BreakCommand,
	BreakOutcome,
	BreakRefusal,
	ClockCommand,
	ClockInCommand,
	ClockInOutcome,
	ClockInRefusal,
	ClockOutCommand,
	ClockOutcome,
	ClockOutOutcome,
	ClockOutRefusal,
	ClockRefusal,
	OperationIdentity,
} from "./types";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ClockingPorts = {
	clock: Clock;
	transactions: ClockTransactions;
	followUps: ClockFollowUps;
};

export type ClockLookupQuery = Pick<
	ClockCommand,
	"organizationId" | "principal" | "subject" | "identity" | "channel"
>;

/** A committed completed-work receipt, as its operation recorded it. */
export type ClockReceipt =
	| { kind: "start_live_work"; result: StartLiveWorkResult }
	| { kind: "close_active_work"; result: CloseActiveWorkResult }
	| { kind: "close_resume_work"; result: CloseResumeWorkResult };

export type ClockLookup =
	| {
			outcome: "committed";
			receipt: ClockReceipt;
			/** The receipt's command: for a frozen command, its payload. */
			command: Record<string, unknown>;
			/** Whether the work the receipt describes still stands unchanged. */
			evidence: "standing" | "changed";
	  }
	/** Nothing is committed under the identity yet; resending the same command is safe. */
	| { outcome: "not_committed" }
	/** Other work or another scope holds the identity. Nothing is disclosed. */
	| { outcome: "conflict" }
	| { outcome: "access_denied" };

export type Clocking = {
	/** Runs one clock command to an executed, replayed or refused outcome. */
	run(command: ClockInCommand): Promise<ClockInOutcome>;
	run(command: ClockOutCommand): Promise<ClockOutOutcome>;
	run(command: BreakCommand): Promise<BreakOutcome>;
	run(command: ClockCommand): Promise<ClockOutcome>;
	/**
	 * The committed receipt of an operation identity, without running anything.
	 * Only receipts of the channel's writer answer; legacy work keeps none.
	 */
	lookup(query: ClockLookupQuery): Promise<ClockLookup>;
};

type Employee = typeof employee.$inferSelect;

/** Client and derived identities name one attempt across retries; server ones never replay. */
function isReplayable(identity: OperationIdentity) {
	return identity.origin !== "server";
}

function refused<R extends ClockRefusal>(failure: R) {
	return { outcome: "refused" as const, failure };
}

function isClockIn(command: ClockCommand): command is ClockInCommand {
	return command.body.kind === "clock_in";
}

function isBreak(command: ClockCommand): command is BreakCommand {
	return command.body.kind === "break";
}

/** Why a closure has nothing to close, for its active or named target. */
type ClockTargetRefusal = "not_clocked_in" | "target_unknown" | "target_not_active";

/**
 * Refusals decided after the first replay read and before the work transaction,
 * which answer only a command that has not committed: the age window of a retry
 * whose original is still in flight, and a holiday. A matching commit between
 * the two reads replays instead. Refusals inside the work transaction follow its
 * own replay.
 */
const LATE_START_REFUSALS = new Set<ClockInRefusal["code"]>([
	"admission_window",
	"holiday_blocked",
]);

/** A matching commit also closes the target after the first replay read. */
const LATE_CLOCK_OUT_REFUSALS = new Set<ClockOutRefusal["code"]>([
	"admission_window",
	"not_clocked_in",
	"target_not_active",
]);

/**
 * A matching break that commits after the first replay read closes its target,
 * or leaves its resumed work as the active target, which this break would close
 * before that work started.
 */
const LATE_BREAK_REFUSALS = new Set<BreakRefusal["code"]>([
	"admission_window",
	"holiday_blocked",
	"not_clocked_in",
	"target_not_active",
	"invalid_interval",
]);

/** The target closed inside the work transaction after it was resolved. */
function targetChanged(command: ClockOutCommand | BreakCommand) {
	const target = command.body.target ?? { kind: "active" };
	return target.kind === "active" ? "not_clocked_in" : "target_not_active";
}

/** Refusals of the shared work-transaction errors, for every kind. */
function transactionRefusal(error: unknown) {
	// A receipt the module cannot interpret counts as one: never resend under this identity.
	if (
		error instanceof CompletedWorkCollisionError ||
		error instanceof CompletedWorkIntegrityError
	) {
		return { code: "collision" as const, cause: error };
	}
	if (error instanceof TimeEntryAppendReviewRequiredError) {
		return { code: "append_review_required" as const, requirement: error.requirement };
	}
	if (error instanceof FrozenCommandNotAcceptedError) {
		return { code: "frozen_not_accepted" as const };
	}
	if (error instanceof LegacyCommandNotAcceptedError) {
		return { code: "legacy_not_accepted" as const };
	}
	return null;
}

/**
 * Why a read-only replay did not answer: a collision reads the same as in the
 * operation's own replay; anything else failed, and nothing was written.
 */
function replayRefusal(error: unknown) {
	const shared = transactionRefusal(error);
	return shared?.code === "collision" ? shared : { code: "failed" as const, cause: error };
}

/** Why the closure's work transaction did not commit, for errors the writers raise. */
function closureRefusal(command: ClockOutCommand, error: unknown): ClockOutRefusal {
	const shared = transactionRefusal(error);
	if (shared) return shared;
	if (error instanceof ClockingConflictError) {
		// The legacy closer's own identity and interval checks.
		if (error.message === "Clock-out action id collision")
			return { code: "collision", cause: error };
		if (error.message === "Clock-out precedes clock-in") return { code: "invalid_interval" };
		return { code: targetChanged(command) };
	}
	if (error instanceof WorkIntervalError) return { code: "invalid_interval" };
	if (error instanceof CompletedWorkAttributionError) {
		if (error.field === "taskId") {
			return { code: "task_not_allowed", reason: error.taskReason ?? "task_not_found" };
		}
		return {
			code: error.field === "projectId" ? "project_not_allowed" : "work_category_not_allowed",
		};
	}
	return { code: "unconfirmed", cause: error };
}

/** Why the start's work transaction did not commit, for errors the writers raise. */
function startRefusal(error: unknown): ClockInRefusal {
	const shared = transactionRefusal(error);
	if (shared) return shared;
	// The employee lifecycle gate, under the employee lock.
	if (error instanceof ClockingAccessError || error instanceof ClockingOrganizationError) {
		return { code: "access_denied" };
	}
	if (error instanceof LiveWorkOccupiedError && error.occupant === "completed_work") {
		return { code: "occupancy_conflict" };
	}
	return { code: "unconfirmed", cause: error };
}

/** Why the break's work transaction did not commit, for errors the writers raise. */
function breakRefusal(command: BreakCommand, error: unknown): BreakRefusal {
	const shared = transactionRefusal(error);
	if (shared) return shared;
	if (isUnresolvedWorkPeriodReview(error)) {
		return {
			code: "under_review",
			review:
				error.conflictType === "pending_time_correction_approval" ? "time_correction" : "approval",
		};
	}
	if (error instanceof LiveWorkOccupiedError) return { code: "occupancy_conflict" };
	if (error instanceof ClockingConflictError) return { code: targetChanged(command) };
	if (error instanceof WorkIntervalError) return { code: "invalid_interval" };
	return { code: "unconfirmed", cause: error };
}

/**
 * The command's age window, checked after committed replay: over a break's own
 * start, the command's instant and its further observations, in that order.
 */
function freshnessRefusal(command: ClockCommand, eventInstant: Instant) {
	const { freshness } = command;
	if (!freshness || command.at.kind !== "occurred") return null;
	const instants = [
		...(isBreak(command) && command.body.start ? [command.body.start.instant] : []),
		eventInstant,
		...(freshness.observed ?? []),
	];
	for (const instant of instants) {
		if (compareInstants(instant, freshness.earliest) < 0) {
			return { code: "admission_window" as const, reason: "too_old" as const };
		}
		if (compareInstants(instant, freshness.latest) > 0) {
			return { code: "admission_window" as const, reason: "in_future" as const };
		}
	}
	return null;
}

/** The capture at an instant, in the device zone observed there, else the fallback. */
function eventCapture(
	command: ClockCommand,
	eventInstant: Instant,
	deviceZone = command.zone.device,
) {
	if (command.principal.kind === "automatic_clock_out") {
		return resolveFallbackTimezoneCapture({
			timestamp: dateFromInstant(eventInstant),
			timezone: command.zone.fallback,
			timezoneSource: "system_target_user_setting",
		});
	}
	// On behalf or at a departure, the event is the subject's, in their zone: never
	// the principal's device.
	if (command.subject.onBehalf || command.principal.kind === "departure") {
		return resolveFallbackTimezoneCapture({
			timestamp: dateFromInstant(eventInstant),
			timezone: command.zone.fallback,
			timezoneSource: "manager_target_user_setting",
		});
	}
	return resolveTimeEntryTimezoneCapture({
		timestamp: dateFromInstant(eventInstant),
		browserTimezone: deviceZone,
		fallbackTimezone: command.zone.fallback,
		browserSource: "browser",
		fallbackSource: "user_setting",
	});
}

/**
 * The Clocking module. Every clock command runs in one fixed order: authorize,
 * billing, committed replay, freshness, the holiday of a start or a break's
 * resumed half, the closure's target and attribution eligibility, then the work
 * transaction (replay again, admission and writer, the occupancy of a started or
 * resumed interval or the canonical record on a legacy close), commit and
 * follow-ups for every executed closure, breaks included. Callers never see
 * admission. A departure principal runs only enlisted in its own departure's work
 * transaction, and is exempt from billing.
 */
export function createClocking(ports: ClockingPorts): Clocking {
	const { clock, transactions, followUps } = ports;

	function transactionScope(plan: ClockInPlan | ClockOutPlan | BreakPlan) {
		return {
			organizationId: plan.employee.organizationId,
			employeeId: plan.employee.id,
			userId: plan.command.principal.userId,
			submissionId: plan.command.identity.id,
		};
	}

	/** A closure's scope also names the work's owner, who differs on behalf. */
	function closureScope(plan: ClockOutPlan) {
		return { ...transactionScope(plan), ownerUserId: plan.employee.userId };
	}

	/**
	 * A departure principal runs only through the adapter enlisted for its own
	 * departure, and an enlisted adapter runs nothing else (#476 decision 20).
	 */
	function isEnlistedFor(command: ClockLookupQuery) {
		const { enlistment } = transactions;
		const { principal } = command;
		if (principal.kind === "automatic_clock_out") {
			if (enlistment?.kind !== "automatic_clock_out") return false;
			const { decision } = enlistment;
			return (
				command.organizationId === decision.organizationId &&
				command.subject.employeeId === decision.employeeId &&
				!command.subject.onBehalf &&
				principal.operationId === decision.operationId &&
				principal.workPeriodId === decision.workPeriodId &&
				principal.userId === decision.provenanceUserId &&
				command.identity.id === decision.operationId &&
				command.identity.origin === "derived" &&
				command.channel === "automatic-clock-out"
			);
		}
		if (command.channel === "automatic-clock-out") return false;
		if (principal.kind !== "departure") return enlistment === undefined;
		return (
			enlistment?.kind === "departure" &&
			enlistment.departureId === principal.departureId &&
			enlistment.organizationId === command.organizationId &&
			enlistment.employeeId === command.subject.employeeId
		);
	}

	/**
	 * Follow-ups of a committed closure. Best-effort ones never fail it; a durable
	 * adapter's failure to stage fails it as `unconfirmed`, since the closure is
	 * already written into the enlisting transaction.
	 */
	async function runFollowUps(
		closed: Omit<ClosedLiveWork, "timezone">,
		command: ClockCommand,
	): Promise<ClockOutAdvice | { failed: unknown }> {
		const closure = { ...closed, timezone: command.zone.fallback };
		if (!followUps.durable) return followUps.afterClockOut(closure).catch(() => ({}));
		try {
			return await followUps.afterClockOut(closure);
		} catch (error) {
			return { failed: error };
		}
	}

	function eventInstantOf(command: ClockCommand) {
		return command.at.kind === "occurred" ? command.at.instant : clock.nowInstant();
	}

	/** A read-only work transaction: nothing it throws wrote anything. */
	async function committedReplay(plan: ClockOutPlan): Promise<ClockOutOutcome | null> {
		try {
			const replay = await transactions.run(closureScope(plan), (coordination) =>
				replayClockOut(coordination, plan),
			);
			return replay ? { outcome: "replayed", ...replay } : null;
		} catch (error) {
			return refused(replayRefusal(error));
		}
	}

	/** A read-only work transaction: nothing it throws wrote anything. */
	async function committedStartReplay(plan: ClockInPlan): Promise<ClockInOutcome | null> {
		try {
			const result = await transactions.start(transactionScope(plan), (scope) =>
				replayClockIn(scope, plan),
			);
			return result ? { outcome: "replayed", result } : null;
		} catch (error) {
			return refused(replayRefusal(error));
		}
	}

	/**
	 * The work a closure closes. A named target is never whichever work happens to
	 * be active now: it is refused once it is no longer active.
	 */
	async function resolveTarget(
		plan: ClockOutPlan | BreakPlan,
	): Promise<ClockOutTarget | { refusal: ClockTargetRefusal }> {
		const target = plan.command.body.target ?? { kind: "active" };
		const [period] = await db
			.select({
				id: workPeriod.id,
				startTime: workPeriod.startTime,
				endTime: workPeriod.endTime,
				isActive: workPeriod.isActive,
				deletedAt: workPeriod.deletedAt,
				workLocationType: workPeriod.workLocationType,
				projectId: workPeriod.projectId,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, plan.employee.organizationId),
					eq(workPeriod.employeeId, plan.employee.id),
					target.kind === "active"
						? isNull(workPeriod.endTime)
						: target.kind === "period"
							? eq(workPeriod.id, target.workPeriodId)
							: eq(workPeriod.clockInId, target.operationId),
				),
			)
			// A start names its own period; should other work share the entry, the open one wins.
			.orderBy(desc(workPeriod.isActive))
			.limit(1);
		if (!period) {
			return { refusal: target.kind === "active" ? "not_clocked_in" : "target_unknown" };
		}
		if (
			target.kind !== "active" &&
			(!period.isActive || period.endTime !== null || period.deletedAt !== null)
		) {
			return { refusal: "target_not_active" };
		}
		return {
			workPeriodId: period.id,
			start: instantFromDate(period.startTime),
			workLocationType: (period.workLocationType as WorkLocationType | null) ?? null,
			projectId: period.projectId,
		};
	}

	async function attributionRefusal(
		plan: ClockOutPlan,
		target: ClockOutTarget,
		eventInstant: Instant,
	): Promise<ClockOutRefusal | null> {
		const { employee: subject, command } = plan;
		const { project, workCategory, task } = command.body;
		const eligibilityTarget = {
			employeeId: subject.id,
			teamId: subject.teamId,
			organizationId: subject.organizationId,
		};
		if (project.kind === "replace" && !(await isProjectEligible(eligibilityTarget, project.id))) {
			return { code: "project_not_allowed" };
		}
		if (task?.kind === "replace") {
			const reason = await projectTaskIneligibility(eligibilityTarget, {
				projectId: attributionAfter(project, target.projectId),
				taskId: task.id,
			});
			if (reason) return { code: "task_not_allowed", reason };
		}
		if (
			workCategory.kind === "replace" &&
			(await workCategoryIneligibility(
				{
					employeeId: subject.id,
					organizationId: subject.organizationId,
					workCategoryId: workCategory.id,
				},
				db,
				// Access is evaluated when the work ends.
				dateFromInstant(eventInstant),
			)) !== null
		) {
			return { code: "work_category_not_allowed" };
		}
		return null;
	}

	/** Closure steps after committed replay; any refusal here may race a matching commit. */
	async function executeClockOut(
		plan: ClockOutPlan,
		eventInstant: Instant,
	): Promise<ClockOutOutcome> {
		const { command } = plan;
		const stale = freshnessRefusal(command, eventInstant);
		if (stale) return refused(stale);
		// A blocking holiday never refuses a clock-out: it would leave live work running.
		const target = await resolveTarget(plan);
		if ("refusal" in target) return refused({ code: target.refusal });
		const attribution = await attributionRefusal(plan, target, eventInstant);
		if (attribution) return refused(attribution);

		let closure: ClockOutClosure;
		try {
			closure = await transactions.run(
				{
					...closureScope(plan),
					workPeriodId: target.workPeriodId,
					endTime: eventInstant,
					projectId: attributionValue(command.body.project),
					...(command.body.task ? { taskId: attributionValue(command.body.task) } : {}),
					workCategoryId: attributionValue(command.body.workCategory),
				},
				(coordination) =>
					closeClockOut(coordination, {
						plan,
						replayable: isReplayable(command.identity),
						target,
						eventInstant,
						capture: eventCapture(command, eventInstant),
					}),
			);
		} catch (error) {
			return refused(closureRefusal(command, error));
		}
		if (closure.disposition === "replayed") {
			return {
				outcome: "replayed",
				result: closure.result,
				durationMinutes: closure.durationMinutes,
				receipt: closure.receipt,
			};
		}
		// Committed: only a durable adapter's failure to stage turns this into a failure.
		const advice = await runFollowUps(closure.closed, command);
		if ("failed" in advice) return refused({ code: "unconfirmed", cause: advice.failed });
		return {
			outcome: "executed",
			result: { ...closure.entry, pendingApproval: undefined, ...advice },
			durationMinutes: closure.closed.durationMinutes,
			receipt: closure.receipt,
		};
	}

	async function runClockOut(command: ClockOutCommand, subject: Employee) {
		const plan = planClockOut(command, subject);
		const replayable = isReplayable(command.identity);
		if (replayable) {
			const replay = await committedReplay(plan);
			if (replay) return replay;
		}
		const outcome = await executeClockOut(plan, eventInstantOf(command));
		if (
			replayable &&
			outcome.outcome === "refused" &&
			LATE_CLOCK_OUT_REFUSALS.has(outcome.failure.code)
		) {
			// A matching command may have committed since the first replay read.
			const replay = await committedReplay(plan);
			if (replay?.outcome === "replayed") return replay;
		}
		return outcome;
	}

	async function runClockIn(command: ClockInCommand, subject: Employee): Promise<ClockInOutcome> {
		const plan = planClockIn(command, subject);
		const replayable = isReplayable(command.identity);
		if (replayable) {
			const replay = await committedStartReplay(plan);
			if (replay) return replay;
		}
		const outcome = await executeClockIn(plan);
		if (
			replayable &&
			outcome.outcome === "refused" &&
			LATE_START_REFUSALS.has(outcome.failure.code)
		) {
			// A matching command may have committed since the first replay read.
			const replay = await committedStartReplay(plan);
			if (replay?.outcome === "replayed") return replay;
		}
		return outcome;
	}

	/**
	 * Start steps after committed replay. Active work and occupancy are read inside
	 * the work transaction, after its own replay, so a matching commit replays there.
	 */
	async function executeClockIn(plan: ClockInPlan): Promise<ClockInOutcome> {
		const { command, employee: subject } = plan;
		const replayable = isReplayable(command.identity);
		const eventInstant = eventInstantOf(command);
		const stale = freshnessRefusal(command, eventInstant);
		if (stale) return refused(stale);
		const validity = await validateTimeEntry(
			subject.organizationId,
			dateFromInstant(eventInstant),
			command.zone.fallback,
		);
		if (!validity.isValid) {
			return refused({ code: "holiday_blocked", holidayName: validity.holidayName });
		}

		let start: ClockInStart;
		try {
			start = await transactions.start(transactionScope(plan), (scope) =>
				startClockIn(scope, {
					plan,
					replayable,
					eventInstant,
					capture: eventCapture(command, eventInstant),
				}),
			);
		} catch (error) {
			return refused(startRefusal(error));
		}
		if (start.disposition === "refused") return refused(start.refusal);
		return { outcome: start.disposition, result: start.entry };
	}

	/** A read-only work transaction: nothing it throws wrote anything. */
	async function committedBreakReplay(plan: BreakPlan): Promise<BreakOutcome | null> {
		try {
			const result = await transactions.run(transactionScope(plan), (coordination) =>
				replayBreak(coordination, plan),
			);
			return result ? { outcome: "replayed", result } : null;
		} catch (error) {
			return refused(replayRefusal(error));
		}
	}

	/** Break steps after committed replay; any refusal here may race a matching commit. */
	async function executeBreak(plan: BreakPlan, eventInstant: Instant): Promise<BreakOutcome> {
		const { command, employee: subject } = plan;
		const stale = freshnessRefusal(command, eventInstant);
		if (stale) return refused(stale);
		// A blocking holiday refuses only the resumed half; closing work is never refused.
		const validity = await validateTimeEntry(
			subject.organizationId,
			dateFromInstant(eventInstant),
			command.zone.fallback,
		);
		if (!validity.isValid) {
			return refused({ code: "holiday_blocked", holidayName: validity.holidayName });
		}
		const target = await resolveTarget(plan);
		if ("refusal" in target) return refused({ code: target.refusal });
		const { start } = command.body;
		const breakStart = breakStartOf(command, eventInstant);
		if (compareInstants(breakStart, target.start) <= 0) {
			return refused({ code: "invalid_interval" });
		}

		let closure: BreakClosure;
		try {
			closure = await transactions.run(
				{ ...transactionScope(plan), workPeriodId: target.workPeriodId, endTime: breakStart },
				(coordination) =>
					takeBreak(coordination, {
						plan,
						replayable: isReplayable(command.identity),
						target,
						// Each endpoint is captured in the zone at its own instant.
						endpoints: {
							close: {
								instant: breakStart,
								capture: eventCapture(command, breakStart, start?.zone ?? command.zone.device),
							},
							resume: { instant: eventInstant, capture: eventCapture(command, eventInstant) },
						},
					}),
			);
		} catch (error) {
			return refused(breakRefusal(command, error));
		}
		if (closure.disposition === "replayed") return { outcome: "replayed", result: closure.result };
		// The break closes work as a clock-out does, with the same follow-ups.
		const advice = await runFollowUps(closure.closed, command);
		if ("failed" in advice) return refused({ code: "unconfirmed", cause: advice.failed });
		return { outcome: "executed", result: { ...closure.result, ...advice } };
	}

	async function runBreak(command: BreakCommand, subject: Employee): Promise<BreakOutcome> {
		const plan = planBreak(command, subject);
		const replayable = isReplayable(command.identity);
		if (replayable) {
			const replay = await committedBreakReplay(plan);
			if (replay) return replay;
		}
		const outcome = await executeBreak(plan, eventInstantOf(command));
		if (
			replayable &&
			outcome.outcome === "refused" &&
			LATE_BREAK_REFUSALS.has(outcome.failure.code)
		) {
			// A matching command may have committed since the first replay read.
			const replay = await committedBreakReplay(plan);
			if (replay?.outcome === "replayed") return replay;
		}
		return outcome;
	}

	async function run(command: ClockCommand): Promise<ClockOutcome> {
		// System authority is the bound decision, never merely a supplied principal.
		if (!isEnlistedFor(command)) return refused({ code: "access_denied" });
		const automatic = command.principal.kind === "automatic_clock_out";
		if (automatic) {
			const binding = transactions.enlistment;
			if (
				binding?.kind !== "automatic_clock_out" ||
				command.body.kind !== "clock_out" ||
				command.body.target?.kind !== "period" ||
				command.body.target.workPeriodId !== binding.decision.workPeriodId ||
				command.at.kind !== "occurred" ||
				compareInstants(command.at.instant, binding.decision.cutoff) !== 0 ||
				command.zone.device !== null ||
				command.zone.fallback !== binding.decision.timezone ||
				command.body.project.kind !== "preserve" ||
				command.body.workCategory.kind !== "preserve" ||
				command.payload !== undefined ||
				command.legacy !== undefined
			)
				return refused({ code: "access_denied" });
		}
		if (
			!CANONICAL_UUID.test(command.identity.id) ||
			(command.payload && command.payload.operationId !== command.identity.id)
		) {
			return refused({ code: "invalid_command" });
		}
		if (isClockIn(command) && !isWorkLocationType(command.body.workLocationType)) {
			return refused({ code: "invalid_work_location" });
		}
		if (isBreak(command) && command.body.start === undefined) {
			const { breakMinutes } = command.body;
			if (!(Number.isInteger(breakMinutes) && breakMinutes >= 1)) {
				return refused({ code: "invalid_break_duration" });
			}
		}
		const departure = command.principal.kind === "departure";
		// On behalf or at a departure, a clock-out names the period it closes; the
		// receipt keeps it.
		if (
			(command.subject.onBehalf || departure) &&
			command.body.kind === "clock_out" &&
			command.body.target?.kind !== "period"
		) {
			return refused({ code: "invalid_command" });
		}
		const subject = await authorizedSubject({ ...command, kind: command.body.kind });
		if (!subject) return refused({ code: "access_denied" });
		// Offboarding is never blocked by a lapsed subscription; seats recount through
		// the departure's billing sync (#476 decision 8).
		// Automatic closure likewise only ends already-live work.
		const billing =
			departure || automatic ? null : await requireBillingForMutation(command.organizationId);
		if (billing && !isBillingMutationAllowed(billing)) {
			return refused({
				code: "billing_required",
				reason: billing.reason ?? "subscription_required",
			});
		}
		if (isClockIn(command)) return runClockIn(command, subject);
		if (isBreak(command)) return runBreak(command, subject);
		return runClockOut(command, subject);
	}

	return {
		// Each kind's outcome follows its command; the overloads state it.
		run: run as Clocking["run"],

		async lookup(query) {
			// Self-service only: a lookup names no command kind to run on behalf.
			if (!isEnlistedFor(query)) return { outcome: "access_denied" };
			const subject = await authorizedSubject(query);
			if (!subject) return { outcome: "access_denied" };
			const owner = { organizationId: subject.organizationId, employeeId: subject.id };
			// Serialized behind any in-flight operation of the employee: the start's
			// acquisition order is a prefix of every clocking writer's. It only reads.
			return transactions.start(
				{ ...owner, userId: query.principal.userId },
				async ({ db: tx }): Promise<ClockLookup> => {
					// Receipts and entries are keyed by the global operation ID. They are read
					// by ID and compared to the scope; anything outside it is only `conflict`.
					const [receipt] = await tx
						.select()
						.from(completedWorkOperation)
						.where(eq(completedWorkOperation.id, query.identity.id))
						.limit(1);
					if (!receipt) {
						const [entry] = await tx
							.select({ id: timeEntry.id })
							.from(timeEntry)
							.where(eq(timeEntry.id, query.identity.id))
							.limit(1);
						return { outcome: entry ? "conflict" : "not_committed" };
					}
					if (
						receipt.organizationId !== owner.organizationId ||
						receipt.employeeId !== owner.employeeId ||
						receipt.writer !== liveClockOutWriter(query.channel).writer
					) {
						return { outcome: "conflict" };
					}
					let committed: ClockReceipt;
					let standing: boolean;
					if (receipt.kind === "start_live_work") {
						committed = { kind: receipt.kind, result: receipt.result as StartLiveWorkResult };
						standing = (await findStandingStart(tx, owner, committed.result)) !== null;
					} else if (receipt.kind === "close_resume_work") {
						committed = { kind: receipt.kind, result: receipt.result as CloseResumeWorkResult };
						standing = await isCloseResumeStanding(tx, owner, committed.result);
					} else if (receipt.kind === "close_active_work") {
						committed = { kind: receipt.kind, result: receipt.result as CloseActiveWorkResult };
						standing = (await findStandingClosure(tx, owner, committed.result)) !== null;
					} else {
						// Another operation's receipt: no clock command commits it.
						return { outcome: "conflict" };
					}
					return {
						outcome: "committed",
						receipt: committed,
						command: receipt.command as Record<string, unknown>,
						evidence: standing ? "standing" : "changed",
					};
				},
			);
		},
	};
}
