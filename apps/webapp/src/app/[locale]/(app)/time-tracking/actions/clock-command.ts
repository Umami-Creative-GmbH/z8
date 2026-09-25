import "server-only";

/**
 * Frozen direct-HTTP clock commands (#275 / T11).
 *
 * Submission and lookup-only recovery for version 2 commands, composed from the
 * existing completed-work operations and outer transaction owners: starts go
 * through `startLiveWork`, closures through `closeActiveWork`, and both commit a
 * `completed_work_operation` receipt with the work. No separate receipt store.
 *
 * Order for a submission, per resolution #263 §2–§5:
 * 1. current access, context assertions and billing;
 * 2. committed replay by receipt, in every adoption mode, before any fresh check;
 * 3. fresh elapsed-age admission, holiday validity, target and attribution checks;
 * 4. the fresh transaction: replay again, then the operation. Fresh commands run
 *    only in organizations whose append control is active (not yet any).
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { completedWorkOperation, employee, timeEntry, workPeriod } from "@/db/schema";
import {
	type createBillingForbiddenResponse,
	isBillingMutationAllowed,
	requireBillingForMutation,
} from "@/lib/billing/guard";
import {
	type Clock,
	dateFromInstant,
	type Instant,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import {
	admitClockCommandAge,
	type ClockCommand,
	type ClockCommandContext,
	type ClockInCommand,
	type ClockOutCommand,
	verifyClockCommandContext,
} from "@/lib/time-tracking/clock-command";
import {
	ClockingAccessError,
	ClockingConflictError,
	ClockingOrganizationError,
	clockingService,
	TimeEntryAppendReviewRequiredError,
} from "@/lib/time-tracking/clocking-service";
import {
	attributionValue,
	type CloseActiveWorkResult,
	CompletedWorkAttributionError,
	CompletedWorkCollisionError,
	CompletedWorkIntegrityError,
	closeActiveWork,
	findStandingClosure,
	replayCloseActiveWork,
} from "@/lib/time-tracking/close-active-work";
import {
	findStandingStart,
	LiveWorkOccupiedError,
	replayStartLiveWork,
	type StartLiveWorkResult,
	startLiveWork,
} from "@/lib/time-tracking/start-live-work";
import { getUtcOffsetMinutesForZone } from "@/lib/time-tracking/timezone-capture";
import { validateTimeEntry } from "@/lib/time-tracking/validation";
import { withWebClockInTransaction } from "@/lib/time-tracking/web-clock-in-transaction";
import { withWebClockOutTransaction } from "@/lib/time-tracking/web-clock-out-transaction";
import { WorkIntervalError } from "@/lib/time-tracking/work-duration";
import type { WorkTransactionScope } from "@/lib/time-tracking/work-transaction";
import { getUserTimezone } from "./auth";
import {
	completeClockOutAfterCommit,
	createOrdinaryApprovalRuntime,
	validateWorkCategoryAssignment,
} from "./clocking";
import { validateProjectAssignment } from "./entry-helpers";
import { checkClockOutNeedsApproval } from "./policy-helpers";
import type { ClockOutResult } from "./types";

export const DIRECT_HTTP_WRITER = {
	writer: "direct_http",
	writerVersion: 1,
	deviceInfo: "api",
} as const;

export type ClockCommandReceipt =
	| { kind: "start_live_work"; result: StartLiveWorkResult }
	| { kind: "close_active_work"; result: CloseActiveWorkResult };

/** Typed actionable failures. None of them wrote anything. */
export type ClockCommandRejection =
	| { code: "access_denied" }
	| {
			code: "billing_required";
			billing: Parameters<typeof createBillingForbiddenResponse>[0];
	  }
	| { code: "context_mismatch"; fields: (keyof ClockCommandContext)[] }
	| { code: "collision" }
	| { code: "not_adopted" }
	| { code: "admission_window"; reason: "too_old" | "in_future" }
	| { code: "not_allowed_at_time"; holidayName?: string }
	| { code: "target_unknown" }
	| { code: "target_not_active" }
	| { code: "already_clocked_in" }
	| { code: "occupancy_conflict" }
	| { code: "invalid_interval" }
	| { code: "attribution_not_allowed"; field: "projectId" | "workCategoryId" }
	| { code: "approval_policy_unavailable" }
	| { code: "approval_routing"; error: string }
	| { code: "append_review_required" }
	| { code: "integrity_review_required" };

export type ClockCommandSubmission =
	| {
			outcome: "executed" | "replayed";
			operationId: string;
			receipt: ClockCommandReceipt;
			/** Post-commit clock-out advice; absent on replay and for starts. */
			clockOut?: Pick<ClockOutResult, "complianceWarnings" | "breakAdjustment">;
	  }
	| ({ outcome: "rejected"; operationId: string } & ClockCommandRejection);

export type ClockCommandLookup =
	| {
			outcome: "committed";
			operationId: string;
			receipt: ClockCommandReceipt;
			command: Record<string, unknown>;
			/** Whether the work the receipt describes is still unchanged. */
			evidence: "standing" | "changed";
	  }
	/** No commit is serialized before this lookup; resend the same command, never a new identity. */
	| { outcome: "not_committed"; operationId: string }
	/** The identity is held by other work or another scope. No details are disclosed. */
	| { outcome: "conflict"; operationId: string };

export type ClockCommandSession = {
	userId: string;
	activeOrganizationId: string | null | undefined;
};

type Actor = {
	userId: string;
	organizationId: string;
	employeeId: string;
	teamId: string | null;
};

class ClockCommandRejectedError extends Error {
	constructor(readonly rejection: ClockCommandRejection) {
		super(rejection.code);
		this.name = "ClockCommandRejectedError";
	}
}

async function requireCommandActor(session: ClockCommandSession): Promise<Actor> {
	const actor = await clockingService.requireActor({
		userId: session.userId,
		activeOrganizationId: session.activeOrganizationId,
	});
	const [row] = await db
		.select({ teamId: employee.teamId })
		.from(employee)
		.where(
			and(eq(employee.id, actor.employee.id), eq(employee.organizationId, actor.organizationId)),
		)
		.limit(1);
	return {
		userId: actor.userId,
		organizationId: actor.organizationId,
		employeeId: actor.employee.id,
		teamId: row?.teamId ?? null,
	};
}

/**
 * Exact committed replay for this writer. The operation ID is also the entry ID
 * its operation writes, so an entry without a matching receipt means the identity
 * was used by other work and can never be this command's commit.
 */
async function replayCommand(
	scope: Pick<WorkTransactionScope, "db" | "assertEmployee">,
	actor: Actor,
	command: ClockCommand,
): Promise<ClockCommandReceipt | null> {
	const input = {
		organizationId: actor.organizationId,
		employeeId: actor.employeeId,
		command,
		writer: DIRECT_HTTP_WRITER.writer,
	};
	const receipt =
		command.kind === "clock_in"
			? await replayStartLiveWork(scope, input).then((replayed) =>
					replayed ? { kind: "start_live_work" as const, result: replayed.result } : null,
				)
			: await replayCloseActiveWork(scope, input).then((replayed) =>
					replayed ? { kind: "close_active_work" as const, result: replayed.result } : null,
				);
	if (receipt) return receipt;
	// Deliberately unscoped: operation IDs are global entry keys, so a use in any
	// organization is a collision. Only the outcome is returned, never the row.
	const [entry] = await scope.db
		.select({ id: timeEntry.id })
		.from(timeEntry)
		.where(eq(timeEntry.id, command.operationId))
		.limit(1);
	if (entry) throw new CompletedWorkCollisionError();
	return null;
}

function replayTransaction<T>(
	actor: Actor,
	operation: (scope: WorkTransactionScope) => Promise<T>,
): Promise<T> {
	// Replay and lookup only read; the clock-in owner's acquisition order is a
	// prefix of every clocking writer's, and its exclusive employee key serializes
	// them behind any in-flight operation for this employee.
	return withWebClockInTransaction(
		{
			organizationId: actor.organizationId,
			employeeId: actor.employeeId,
			userId: actor.userId,
		},
		operation,
	);
}

function capture(command: ClockCommand, instant: Instant) {
	return {
		utcOffsetMinutes: getUtcOffsetMinutesForZone(dateFromInstant(instant), command.timezone),
		timezone: command.timezone,
		// Captured by the client at event time, like the web browser capture.
		timezoneSource: "browser" as const,
	};
}

function mapFailure(error: unknown): ClockCommandRejection | null {
	if (error instanceof ClockCommandRejectedError) return error.rejection;
	if (error instanceof ClockingAccessError || error instanceof ClockingOrganizationError) {
		return { code: "access_denied" };
	}
	if (error instanceof CompletedWorkCollisionError) return { code: "collision" };
	// Committed evidence the operation cannot interpret: hold for review, do not resend.
	if (error instanceof CompletedWorkIntegrityError) return { code: "integrity_review_required" };
	if (error instanceof LiveWorkOccupiedError) {
		return {
			code: error.occupant === "active_work" ? "already_clocked_in" : "occupancy_conflict",
		};
	}
	if (error instanceof ClockingConflictError) {
		return error.message === "No active work period found" ||
			error.message === "Active work period changed"
			? { code: "target_not_active" }
			: null;
	}
	if (error instanceof WorkIntervalError) return { code: "invalid_interval" };
	if (error instanceof CompletedWorkAttributionError) {
		return { code: "attribution_not_allowed", field: error.field };
	}
	if (error instanceof TimeEntryAppendReviewRequiredError) {
		return { code: "append_review_required" };
	}
	if (
		error instanceof ValidationError &&
		error.field === "managerId" &&
		error.message === "No manager assigned to approve time changes"
	) {
		return { code: "approval_routing", error: error.message };
	}
	return null;
}

export type SubmitClockCommandInput = {
	command: ClockCommand;
	session: ClockCommandSession;
	/** The public origin that served the request; null when it is unknown. */
	serverOrigin: string | null;
	clock?: Clock;
};

/**
 * Submits one frozen command. Returns the executed or replayed committed receipt,
 * or a typed rejection that wrote nothing. Any thrown error leaves the outcome
 * unknown: the client looks it up and may resend the same command.
 */
export async function submitClockCommand(
	input: SubmitClockCommandInput,
): Promise<ClockCommandSubmission> {
	const { command } = input;
	const clock = input.clock ?? systemClock;
	try {
		let actor: Actor;
		try {
			actor = await requireCommandActor(input.session);
		} catch (error) {
			if (error instanceof ClockingAccessError)
				throw new ClockCommandRejectedError({ code: "access_denied" });
			throw error;
		}
		const mismatched = verifyClockCommandContext(command.context, {
			userId: actor.userId,
			organizationId: actor.organizationId,
			employeeId: actor.employeeId,
			server: input.serverOrigin,
		});
		if (mismatched.length > 0) {
			throw new ClockCommandRejectedError({ code: "context_mismatch", fields: mismatched });
		}
		const billing = await requireBillingForMutation(actor.organizationId);
		if (!isBillingMutationAllowed(billing)) {
			throw new ClockCommandRejectedError({ code: "billing_required", billing });
		}

		const committed = await replayTransaction(actor, (scope) =>
			replayCommand(scope, actor, command),
		);
		if (committed) {
			return { outcome: "replayed", operationId: command.operationId, receipt: committed };
		}

		try {
			return await submitFresh(actor, command, clock);
		} catch (error) {
			// An identical request may have committed after the replay check above,
			// making a preflight read (such as the close target) stale. That commit,
			// not this attempt's late refusal, is the command's outcome.
			if (!mapFailure(error)) throw error;
			const raced = await replayTransaction(actor, (scope) => replayCommand(scope, actor, command));
			if (raced) return { outcome: "replayed", operationId: command.operationId, receipt: raced };
			throw error;
		}
	} catch (error) {
		const rejection = mapFailure(error);
		if (!rejection) throw error;
		return { outcome: "rejected", operationId: command.operationId, ...rejection };
	}
}

/** Fresh admission and execution, after committed replay was ruled out. */
async function submitFresh(
	actor: Actor,
	command: ClockCommand,
	clock: Clock,
): Promise<ClockCommandSubmission> {
	const occurredAt = parseInstant(command.occurredAt);
	const age = admitClockCommandAge(command.admission, occurredAt, clock.nowInstant());
	if (!age.admitted) {
		throw new ClockCommandRejectedError({ code: "admission_window", reason: age.reason });
	}
	const validity = await validateTimeEntry(
		actor.organizationId,
		dateFromInstant(occurredAt),
		command.timezone,
	);
	if (!validity.isValid) {
		throw new ClockCommandRejectedError({
			code: "not_allowed_at_time",
			holidayName: validity.holidayName,
		});
	}
	return command.kind === "clock_in"
		? submitStart(actor, command, occurredAt)
		: submitClose(actor, command, occurredAt);
}

async function submitStart(
	actor: Actor,
	command: ClockInCommand,
	occurredAt: Instant,
): Promise<ClockCommandSubmission> {
	return withWebClockInTransaction(
		{
			organizationId: actor.organizationId,
			employeeId: actor.employeeId,
			userId: actor.userId,
		},
		async (scope) => {
			const committed = await replayCommand(scope, actor, command);
			if (committed) {
				return {
					outcome: "replayed" as const,
					operationId: command.operationId,
					receipt: committed,
				};
			}
			if (scope.admission !== "append")
				throw new ClockCommandRejectedError({ code: "not_adopted" });
			const started = await startLiveWork(scope, {
				organizationId: actor.organizationId,
				employeeId: actor.employeeId,
				actorUserId: actor.userId,
				command,
				writer: DIRECT_HTTP_WRITER,
				eventInstant: occurredAt,
				capture: capture(command, occurredAt),
			});
			return {
				outcome: "executed" as const,
				operationId: command.operationId,
				receipt: { kind: "start_live_work" as const, result: started.result },
			};
		},
	);
}

/**
 * The close target is the known period, or the period the named clock-in
 * operation created. It is never whichever period happens to be active now.
 */
async function resolveCloseTarget(actor: Actor, command: ClockOutCommand) {
	const [period] = await db
		.select({
			id: workPeriod.id,
			isActive: workPeriod.isActive,
			endTime: workPeriod.endTime,
			deletedAt: workPeriod.deletedAt,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, actor.organizationId),
				eq(workPeriod.employeeId, actor.employeeId),
				"workPeriodId" in command.target
					? eq(workPeriod.id, command.target.workPeriodId)
					: eq(workPeriod.clockInId, command.target.clockInOperationId),
			),
		)
		.limit(1);
	if (!period) throw new ClockCommandRejectedError({ code: "target_unknown" });
	if (!period.isActive || period.endTime !== null || period.deletedAt !== null) {
		throw new ClockCommandRejectedError({ code: "target_not_active" });
	}
	return period.id;
}

async function submitClose(
	actor: Actor,
	command: ClockOutCommand,
	occurredAt: Instant,
): Promise<ClockCommandSubmission> {
	const workPeriodId = await resolveCloseTarget(actor, command);
	const projectId = attributionValue(command.project);
	const workCategoryId = attributionValue(command.workCategory);
	if (projectId) {
		const eligibility = await validateProjectAssignment(
			projectId,
			actor.employeeId,
			actor.teamId,
			actor.organizationId,
		);
		if (!eligibility.isValid) {
			throw new ClockCommandRejectedError({ code: "attribution_not_allowed", field: "projectId" });
		}
	}
	if (workCategoryId) {
		const eligibility = await validateWorkCategoryAssignment(
			actor.employeeId,
			workCategoryId,
			actor.organizationId,
		);
		if (!eligibility.isValid) {
			throw new ClockCommandRejectedError({
				code: "attribution_not_allowed",
				field: "workCategoryId",
			});
		}
	}
	let requiresApproval: boolean;
	try {
		requiresApproval = await checkClockOutNeedsApproval(actor.employeeId);
	} catch {
		throw new ClockCommandRejectedError({ code: "approval_policy_unavailable" });
	}

	const result = await withWebClockOutTransaction(
		{
			organizationId: actor.organizationId,
			employeeId: actor.employeeId,
			userId: actor.userId,
			submissionId: command.operationId,
			workPeriodId,
			endTime: occurredAt,
			requiresApproval,
			projectId,
			workCategoryId,
		},
		createOrdinaryApprovalRuntime,
		async (coordination) => {
			const committed = await replayCommand(coordination, actor, command);
			if (committed) return { kind: "replayed" as const, receipt: committed };
			if (coordination.admission !== "append")
				throw new ClockCommandRejectedError({ code: "not_adopted" });
			return {
				kind: "executed" as const,
				closed: await closeActiveWork(coordination, {
					organizationId: actor.organizationId,
					employeeId: actor.employeeId,
					teamId: actor.teamId,
					actorUserId: actor.userId,
					workPeriodId,
					command,
					writer: DIRECT_HTTP_WRITER,
					eventInstant: occurredAt,
					capture: capture(command, occurredAt),
				}),
			};
		},
	);
	if (result.kind === "replayed") {
		return { outcome: "replayed", operationId: command.operationId, receipt: result.receipt };
	}

	const { closed } = result;
	const advice = await completeClockOutAfterCommit({
		outcome: {
			entry: closed.entry,
			disposition: closed.disposition,
			durationMinutes: closed.result.segment.durationMinutes,
			approvalSubmission: closed.approvalSubmission ?? undefined,
			workPeriodId: closed.result.workPeriodId,
			startTime: dateFromInstant(parseInstant(closed.result.segment.startAt)),
			endTime: dateFromInstant(parseInstant(closed.result.segment.endAt)),
			surchargeSnapshot: closed.surchargeSnapshot,
			balanceRefreshCommitted: true,
		},
		employee: { id: actor.employeeId, organizationId: actor.organizationId },
		userId: actor.userId,
		needsClockOutApproval: requiresApproval,
		timezone: await getUserTimezone(actor.userId).catch(() => command.timezone),
		projectId: closed.result.attribution.projectId,
	});
	return {
		outcome: "executed",
		operationId: command.operationId,
		receipt: { kind: "close_active_work", result: closed.result },
		clockOut: {
			complianceWarnings: advice.complianceWarnings,
			breakAdjustment: advice.breakAdjustment,
		},
	};
}

/**
 * Lookup-only recovery. Serialized behind any in-flight operation of the
 * authenticated employee; it never creates, repairs or re-executes work.
 */
export async function lookupClockCommand(input: {
	operationId: string;
	session: ClockCommandSession;
}): Promise<ClockCommandLookup | { outcome: "rejected"; code: "access_denied" }> {
	let actor: Actor;
	try {
		actor = await requireCommandActor(input.session);
	} catch (error) {
		if (error instanceof ClockingAccessError) return { outcome: "rejected", code: "access_denied" };
		throw error;
	}
	const { operationId } = input;
	return replayTransaction(actor, async (scope): Promise<ClockCommandLookup> => {
		// Receipts and entries are keyed by the global operation ID. They are read
		// by ID and compared to the authenticated scope, and anything outside it is
		// only ever reported as `conflict`. Lookup runs in the active context: a
		// client whose captured context differs pauses instead of looking up.
		const [receipt] = await scope.db
			.select()
			.from(completedWorkOperation)
			.where(eq(completedWorkOperation.id, operationId))
			.limit(1);
		if (receipt) {
			if (
				receipt.organizationId !== actor.organizationId ||
				receipt.employeeId !== actor.employeeId ||
				receipt.writer !== DIRECT_HTTP_WRITER.writer
			) {
				return { outcome: "conflict", operationId };
			}
			const standing =
				receipt.kind === "start_live_work"
					? await findStandingStart(scope.db, actor, receipt.result as StartLiveWorkResult)
					: await findStandingClosure(scope.db, actor, receipt.result as CloseActiveWorkResult);
			return {
				outcome: "committed",
				operationId,
				receipt:
					receipt.kind === "start_live_work"
						? { kind: "start_live_work", result: receipt.result as StartLiveWorkResult }
						: { kind: "close_active_work", result: receipt.result as CloseActiveWorkResult },
				command: receipt.command,
				evidence: standing ? "standing" : "changed",
			};
		}
		const [entry] = await scope.db
			.select({ id: timeEntry.id })
			.from(timeEntry)
			.where(eq(timeEntry.id, operationId))
			.limit(1);
		return entry ? { outcome: "conflict", operationId } : { outcome: "not_committed", operationId };
	});
}
