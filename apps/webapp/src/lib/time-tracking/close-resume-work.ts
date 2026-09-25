import "server-only";

/**
 * Completed-work operation for a confirmed desktop idle break (#281 / T17,
 * resolution #263 §8, design #256).
 *
 * One call inside the clock-out outer transaction closes the intended active
 * period at the estimated idle start and resumes live work at the detected
 * return, each endpoint with its own captured zone. Both graph changes, their
 * append progression, the closure's approval participation and work-balance
 * intent, and the single committed receipt commit together or not at all.
 *
 * The resumed clock-in entry takes the operation ID, so a later command binds
 * the resumed work as `{ clockInOperationId: <break operation> }`. The clock-out
 * entry gets a fresh server identity that only the receipt names.
 *
 * Exact replay of a committed receipt writes nothing. A break never applies to
 * another period than its target, and it waits while the target is under review.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { type CompletedWorkWriter, completedWorkOperation, workPeriod } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { canonicalJson } from "./canonical-json";
import type { Entry } from "./clocking-core";
import {
	type CloseActiveWorkResult,
	type CloseActiveWorkWriter,
	type ClosedActiveWork,
	CompletedWorkCollisionError,
	CompletedWorkIntegrityError,
	closeActiveWorkGraph,
	findStandingClosure,
} from "./close-active-work";
import { findStandingStart, type StartLiveWorkResult, startLiveWorkGraph } from "./start-live-work";
import type { TimeEntryTimezoneSource } from "./timezone-capture";
import type { WorkTransactionContext } from "./web-clock-out-transaction";
import type { WorkLocationType } from "./work-location";
import { assertNoUnresolvedWorkPeriodReview } from "./work-period-review";
import type { WorkTransactionScope } from "./work-transaction";

export const CLOSE_RESUME_WORK_RESULT_VERSION = 1;

/** What the operation reads from a writer's frozen command; the receipt stores it whole. */
export type CloseResumeWorkOperationCommand = {
	version: number;
	operationId: string;
	/** Location of the resumed work. */
	workLocationType: WorkLocationType;
};

/** Committed result (receipt version 1). Current clock state is a separate read. */
export type CloseResumeWorkResult = {
	version: typeof CLOSE_RESUME_WORK_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	actor: { kind: "human"; userId: string };
	/** The target closed at the break start, as a close operation would record it. */
	close: CloseActiveWorkResult;
	/** The work resumed at the detected return, as a start operation would record it. */
	resume: StartLiveWorkResult;
};

export type CloseResumeWorkReceipt = {
	disposition: "executed" | "replayed";
	result: CloseResumeWorkResult;
};

type Endpoint = {
	instant: Instant;
	capture: {
		utcOffsetMinutes: number;
		timezone: string;
		timezoneSource: TimeEntryTimezoneSource;
	};
};

export type CloseResumeWorkInput = {
	organizationId: string;
	employeeId: string;
	teamId: string | null;
	/** The authenticated human confirming the break. */
	actorUserId: string;
	/** The resolved target: the period the break was captured against. */
	workPeriodId: string;
	command: CloseResumeWorkOperationCommand;
	writer: CloseActiveWorkWriter;
	/** The estimated idle start. */
	close: Endpoint;
	/** The detected return. */
	resume: Endpoint;
};

/**
 * Exact receipt replay. Returns null when no receipt exists for the identity. Any
 * mismatch in scope, kind, writer or command is a collision; nothing is repaired.
 */
export async function replayCloseResumeWork(
	context: Pick<WorkTransactionScope, "db" | "assertEmployee">,
	input: {
		organizationId: string;
		employeeId: string;
		command: Pick<CloseResumeWorkOperationCommand, "version" | "operationId">;
		writer: CompletedWorkWriter;
	},
): Promise<CloseResumeWorkReceipt | null> {
	context.assertEmployee(input.organizationId, input.employeeId);
	const [receipt] = await context.db
		.select()
		.from(completedWorkOperation)
		.where(eq(completedWorkOperation.id, input.command.operationId))
		.limit(1);
	if (!receipt) return null;
	if (
		receipt.organizationId !== input.organizationId ||
		receipt.employeeId !== input.employeeId ||
		receipt.kind !== "close_resume_work" ||
		receipt.writer !== input.writer ||
		receipt.commandVersion !== input.command.version ||
		canonicalJson(receipt.command) !== canonicalJson(input.command)
	) {
		throw new CompletedWorkCollisionError();
	}
	if (receipt.resultVersion !== CLOSE_RESUME_WORK_RESULT_VERSION) {
		throw new CompletedWorkIntegrityError("Unsupported completed-work receipt version");
	}
	const result = receipt.result as CloseResumeWorkResult;
	if (!(await isCloseResumeStanding(context.db, input, result))) {
		throw new CompletedWorkCollisionError();
	}
	return { disposition: "replayed", result };
}

/** Whether both the closure and the resumed start the receipt describes still stand. */
export async function isCloseResumeStanding(
	tx: WorkTransactionScope["db"],
	scope: { organizationId: string; employeeId: string },
	result: Pick<CloseResumeWorkResult, "close" | "resume">,
): Promise<boolean> {
	const [closure, start] = await Promise.all([
		findStandingClosure(tx, scope, result.close),
		findStandingStart(tx, scope, result.resume),
	]);
	return closure !== null && start !== null;
}

export type ClosedAndResumedWork = CloseResumeWorkReceipt & {
	disposition: "executed";
	/** The closure's parts the post-commit clock-out follow-ups need. */
	closed: ClosedActiveWork;
	resumedEntry: Entry;
};

/**
 * Fresh break. The caller has already ruled out committed replay; an existing
 * entry or receipt with this identity is therefore a collision.
 */
export async function closeAndResumeWork(
	context: WorkTransactionContext,
	input: CloseResumeWorkInput,
): Promise<ClosedAndResumedWork> {
	const { organizationId, employeeId, command } = input;
	context.assertEmployee(organizationId, employeeId);
	const [target] = await context.db
		.select({ id: workPeriod.id, approvalStatus: workPeriod.approvalStatus })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
			),
		)
		.limit(1);
	// A missing target is refused by the closure below with the usual conflict.
	if (target) await assertNoUnresolvedWorkPeriodReview(context.db, organizationId, target);

	const closed = await closeActiveWorkGraph(
		context,
		{
			organizationId,
			employeeId,
			teamId: input.teamId,
			actorUserId: input.actorUserId,
			workPeriodId: input.workPeriodId,
			// A break changes no attribution of the work it closes.
			command: {
				version: command.version,
				operationId: command.operationId,
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			},
			writer: input.writer,
			eventInstant: input.close.instant,
			capture: input.close.capture,
		},
		randomUUID(),
	);
	// Symmetric occupancy for the resumed interval runs after the closure, so the
	// closed target no longer occupies it and any other work still does.
	const resumed = await startLiveWorkGraph(context, {
		organizationId,
		employeeId,
		actorUserId: input.actorUserId,
		command,
		writer: input.writer,
		eventInstant: input.resume.instant,
		capture: input.resume.capture,
	});

	const result: CloseResumeWorkResult = {
		version: CLOSE_RESUME_WORK_RESULT_VERSION,
		operationId: command.operationId,
		owner: { employeeId },
		actor: { kind: "human", userId: input.actorUserId },
		close: closed.result,
		resume: resumed.result,
	};
	await context.db.insert(completedWorkOperation).values({
		id: command.operationId,
		organizationId,
		employeeId,
		kind: "close_resume_work",
		writer: input.writer.writer,
		writerVersion: input.writer.writerVersion,
		commandVersion: command.version,
		command,
		appendAdmission: resumed.result.append.admission,
		actorKind: "human",
		actorUserId: input.actorUserId,
		// The source the break was bound to; the resumed period is in the result.
		workPeriodId: closed.result.workPeriodId,
		resultVersion: CLOSE_RESUME_WORK_RESULT_VERSION,
		result,
	});
	return { disposition: "executed", result, closed, resumedEntry: resumed.entry };
}
