import "server-only";

/**
 * Runtime demo work adapter (#285 / T21, design #256/#262).
 *
 * Demo generation, correction and cleanup are runtime writers of the employee work
 * graph, so they take the shared work coordination: the organization adoption gate
 * (reading the append control under it), organization configuration, the
 * triggering admin's configuration/access guard and the sorted employee keys.
 *
 * Every generated session is created through work records (ADR 0010, #1223) in
 * either admission: linked entries, a closed period and its canonical work
 * record in agreement, with the effects. Overlapping work leaves the day
 * untouched. In an adopted organization each session also gets a
 * `completed_work_operation` receipt that names the demo generator as the
 * executing system actor (no actor user) and records the triggering admin in its
 * result. Demo generation is unkeyed, so its receipts are evidence, never replay
 * identities. Demo attribution changes amend through work records, and cleanup
 * erases the work history through it.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import {
	completedWorkOperation,
	historicalWorkProposal,
	workBreakAdjustmentIntent,
	workPeriod,
} from "@/db/schema";
import { deleteWorkPeriodApprovalEvidence } from "@/lib/approvals/maintenance";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { AppendReviewRequirement } from "@/lib/time-tracking/time-entry-append";
import { resolveFallbackTimezoneCapture } from "@/lib/time-tracking/timezone-capture";
import type { WorkVehicleUse } from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import {
	type AmendAttributionPatch,
	applyWorkRecordChange,
	eraseEmployeeWorkHistory,
	isWorkRecordRefusal,
	type NewWorkCreation,
	orRefuse,
	readWorkRecord,
	type WorkRecord,
} from "@/lib/time-tracking/work-records";
import {
	runWorkTransaction,
	type SealedWorkTransactionScope,
	type WorkRoute,
	type WorkTransactionClient,
	type WorkTransactionScope,
} from "@/lib/time-tracking/work-transaction";
export const DEMO_WORK_COMMAND_VERSION = 1;
export const DEMO_WORK_RESULT_VERSION = 1;
export const RUNTIME_DEMO_WRITER_VERSION = 1;

export interface DemoWorkCoordinationInput {
	organizationId: string;
	/** The authorized admin who triggered the operation; null for system cleanup. */
	triggeringUserId: string | null;
	/** Every employee whose work graph the operation may change. */
	employeeIds: readonly string[];
	/** Other users whose access the operation depends on (e.g. requester, approver). */
	accessUserIds?: readonly string[];
}

/**
 * Demo's fixed routing: the triggering admin and the other access users, and
 * every coordinated employee, each of which the operation may write.
 */
function routeDemoWork(input: DemoWorkCoordinationInput): WorkRoute {
	return {
		users: [
			...(input.triggeringUserId ? [input.triggeringUserId] : []),
			...(input.accessUserIds ?? []),
		],
		employees: input.employeeIds,
		writeTargets: input.employeeIds,
	};
}

/** One coordinated work transaction for a demo operation. */
export function withDemoWorkTransaction<T>(
	input: DemoWorkCoordinationInput,
	operation: (scope: WorkTransactionScope) => Promise<T>,
): Promise<T> {
	return runWorkTransaction(
		{ organizationId: input.organizationId, route: async () => routeDemoWork(input) },
		operation,
	);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export type DemoWorkSession = {
	start: Instant;
	end: Instant;
	clockInNotes: string;
	clockOutNotes: string;
};

export type DemoWorkCommand = {
	version: typeof DEMO_WORK_COMMAND_VERSION;
	/** One demo generation request; unkeyed, so never a replay identity. */
	runId: string;
	sessionIndex: number;
	startAt: string;
	endAt: string;
};

export type DemoWorkResult = {
	version: typeof DEMO_WORK_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	actors: {
		executing: { kind: "system"; process: "runtime_demo" };
		triggeredBy: { kind: "human"; userId: string };
	};
	workPeriodId: string;
	clockInEntryId: string;
	clockOutEntryId: string;
	canonicalRecordId: string;
	segment: {
		startAt: string;
		endAt: string;
		durationMinutes: number;
		startUtcOffsetMinutes: number;
		endUtcOffsetMinutes: number;
		timezone: string;
		timezoneSource: "backfill";
	};
	attribution: { projectId: null; workCategoryId: null; workLocationType: null };
	revisions: { workPeriod: { source: null; result: number } };
	append: {
		admission: "append";
		clockIn: { previousEntryId: string | null; previousHash: string | null };
		clockOut: { previousEntryId: string; previousHash: string };
	};
	approvalState: "approved";
	approval: { participation: "none" };
	followUps: [
		{ kind: "work_balance_refresh"; delivery: "committed_intent"; dirtyFromDate: string },
	];
};

export type DemoWorkDayOutcome =
	| { kind: "recorded"; timeEntriesCreated: number; workPeriodsCreated: number }
	| { kind: "held_for_review"; requirement: AppendReviewRequirement }
	| { kind: "occupied" };

export interface DemoWorkDayInput {
	organizationId: string;
	employeeId: string;
	triggeringUserId: string;
	runId: string;
	sessions: readonly DemoWorkSession[];
}

// Demo sessions carry no zone evidence; they are captured as UTC backfill.
function demoCapture(instant: Instant) {
	return resolveFallbackTimezoneCapture({
		timestamp: dateFromInstant(instant),
		timezone: "UTC",
		timezoneSource: "backfill",
	});
}

/**
 * Persists one employee-day of generated sessions in the caller's coordinated
 * transaction, each created through work records with its canonical work record
 * (#1223). Overlapping work leaves the whole day untouched. The caller owns the
 * transaction, so a failure rolls back the day.
 */
export async function recordDemoWorkDay(
	scope: SealedWorkTransactionScope,
	input: DemoWorkDayInput,
): Promise<DemoWorkDayOutcome> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	if (input.sessions.length === 0) {
		return { kind: "recorded", timeEntriesCreated: 0, workPeriodsCreated: 0 };
	}
	if (await isOccupied(scope.db, input)) return { kind: "occupied" };
	for (const [sessionIndex, session] of input.sessions.entries()) {
		const created = await applyWorkRecordChange(scope, {
			kind: "create_new",
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			start: {
				at: session.start,
				notes: session.clockInNotes,
				capture: demoCapture(session.start),
			},
			end: { at: session.end, notes: session.clockOutNotes, capture: demoCapture(session.end) },
			approval: { state: "approved" },
			origin: "clock",
			recordedBy: input.triggeringUserId,
			actorUserId: input.triggeringUserId,
			entries: { createdBy: input.triggeringUserId, ipAddress: null, deviceInfo: null },
			appendOperation: "demo_generation",
		});
		// The first session is admitted before anything of the day is written.
		if (created.kind === "append_review_required" && sessionIndex === 0) {
			return { kind: "held_for_review", requirement: created.requirement };
		}
		const creation = orRefuse<NewWorkCreation>(created);
		if (creation.appended.admission === "append") {
			await recordDemoReceipt(scope.db, input, sessionIndex, creation);
		}
	}
	return {
		kind: "recorded",
		timeEntriesCreated: input.sessions.length * 2,
		workPeriodsCreated: input.sessions.length,
	};
}

/**
 * Symmetric half-open occupancy: nondeleted work (any approval state) occupies
 * [start, end); active work occupies its start onward. Adjacency is valid.
 */
async function isOccupied(
	client: WorkTransactionClient,
	input: DemoWorkDayInput,
): Promise<boolean> {
	const intervals = input.sessions.map((session) =>
		and(
			lt(workPeriod.startTime, dateFromInstant(session.end)),
			or(isNull(workPeriod.endTime), gt(workPeriod.endTime, dateFromInstant(session.start))),
		),
	);
	const [occupant] = await client
		.select({ id: workPeriod.id })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				isNull(workPeriod.deletedAt),
				or(...intervals),
			),
		)
		.limit(1);
	return occupant !== undefined;
}

/**
 * An adopted organization's receipt of one generated session: evidence naming
 * the demo generator as the executing system actor, never a replay identity.
 */
async function recordDemoReceipt(
	client: WorkTransactionClient,
	input: DemoWorkDayInput,
	sessionIndex: number,
	creation: NewWorkCreation,
): Promise<void> {
	const operationId = randomUUID();
	const [clockIn, clockOut] = creation.appended.entries;
	const result: DemoWorkResult = {
		version: DEMO_WORK_RESULT_VERSION,
		operationId,
		owner: { employeeId: input.employeeId },
		actors: {
			executing: { kind: "system", process: "runtime_demo" },
			triggeredBy: { kind: "human", userId: input.triggeringUserId },
		},
		workPeriodId: creation.segment.workPeriodId,
		clockInEntryId: clockIn.id,
		clockOutEntryId: clockOut.id,
		canonicalRecordId: creation.segment.canonicalRecordId,
		segment: {
			startAt: creation.segment.startAt,
			endAt: creation.segment.endAt,
			durationMinutes: creation.segment.durationMinutes,
			startUtcOffsetMinutes: clockIn.utcOffsetMinutes ?? 0,
			endUtcOffsetMinutes: clockOut.utcOffsetMinutes ?? 0,
			timezone: clockOut.timezone ?? "UTC",
			timezoneSource: "backfill",
		},
		attribution: { projectId: null, workCategoryId: null, workLocationType: null },
		revisions: { workPeriod: { source: null, result: creation.after.revision } },
		append: {
			admission: "append",
			clockIn: {
				previousEntryId: creation.appended.clockIn.previousEntryId,
				previousHash: creation.appended.clockIn.previousHash,
			},
			clockOut: { previousEntryId: clockIn.id, previousHash: clockIn.hash },
		},
		approvalState: "approved",
		approval: { participation: "none" },
		followUps: [
			{
				kind: "work_balance_refresh",
				delivery: "committed_intent",
				dirtyFromDate: creation.effects.workBalanceDirtyFromDate,
			},
		],
	};
	const command: DemoWorkCommand = {
		version: DEMO_WORK_COMMAND_VERSION,
		runId: input.runId,
		sessionIndex,
		startAt: result.segment.startAt,
		endAt: result.segment.endAt,
	};
	await client.insert(completedWorkOperation).values({
		id: operationId,
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		kind: "create_completed_work",
		writer: "runtime_demo",
		writerVersion: RUNTIME_DEMO_WRITER_VERSION,
		commandVersion: DEMO_WORK_COMMAND_VERSION,
		command,
		appendAdmission: "append",
		actorKind: "system",
		// The column names a human actor only; the triggering admin is in the result.
		actorUserId: null,
		workPeriodId: creation.segment.workPeriodId,
		resultVersion: DEMO_WORK_RESULT_VERSION,
		result,
	});
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * Amends one demo period's work attribution through work records (#1223): only
 * settled work (completed, approved, nothing pending, with its canonical work
 * record) changes; anything else, or a refusal, leaves it as it is.
 */
async function amendDemoAttribution(
	scope: SealedWorkTransactionScope,
	input: { organizationId: string; employeeId: string; workPeriodId: string },
	patch: AmendAttributionPatch,
	settled: (record: WorkRecord) => boolean,
): Promise<boolean> {
	const record = await readWorkRecord(scope, input, { lock: true });
	if (
		!record ||
		record.period.isActive ||
		record.period.approvalStatus !== "approved" ||
		record.period.pendingChanges !== null ||
		!record.canonical ||
		!settled(record)
	) {
		return false;
	}
	const amended = await applyWorkRecordChange(scope, {
		kind: "amend",
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		expected: record.expected,
		attribution: patch,
		actorUserId: null,
	});
	return !isWorkRecordRefusal(amended) || amended.kind === "unchanged";
}

/** Assigns a demo work category to one completed period. */
export async function assignDemoWorkCategory(
	scope: SealedWorkTransactionScope,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		workCategoryId: string;
	},
): Promise<boolean> {
	return amendDemoAttribution(scope, input, { workCategoryId: input.workCategoryId }, () => true);
}

/** Records demo vehicle use (#1132) on one completed period that has none. */
export async function assignDemoVehicleUse(
	scope: SealedWorkTransactionScope,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		use: WorkVehicleUse;
	},
): Promise<boolean> {
	return amendDemoAttribution(
		scope,
		input,
		{ vehicleUse: input.use },
		(record) => record.attribution.vehicleUse === null,
	);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export type DemoHistoryDeletion = {
	workPeriodsDeleted: number;
	workPeriodsWithCategory: number;
	timeEntriesDeleted: number;
};

/**
 * Removes one employee's whole time history atomically under its employee key:
 * approval lifecycle evidence (#302), then the work itself through work records
 * (periods, their canonical work records except those a retained approval
 * request references, entries and the append position, with the effects,
 * #1223), then proposals (#323), break adjustment intents (#305) and receipts,
 * which describe that history by value. No other employee or organization is
 * touched.
 */
export async function deleteDemoEmployeeHistory(
	scope: SealedWorkTransactionScope,
	input: { organizationId: string; employeeId: string; triggeringUserId?: string | null },
): Promise<DemoHistoryDeletion> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	const client = scope.db;
	// Manual/policy clock-out approval evidence describes this history (#302).
	await deleteWorkPeriodApprovalEvidence(client, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
	});
	const erased = await eraseEmployeeWorkHistory(scope, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		actorUserId: input.triggeringUserId ?? null,
	});
	// Explicit proposals (#323) copy that history by value; the append position referenced
	// an applied continuation, so they go after it.
	await client
		.delete(historicalWorkProposal)
		.where(
			and(
				eq(historicalWorkProposal.organizationId, input.organizationId),
				eq(historicalWorkProposal.employeeId, input.employeeId),
			),
		);
	// Automatic break adjustment intents (#305) name that history's periods by value.
	await client
		.delete(workBreakAdjustmentIntent)
		.where(
			and(
				eq(workBreakAdjustmentIntent.organizationId, input.organizationId),
				eq(workBreakAdjustmentIntent.employeeId, input.employeeId),
			),
		);
	// Operation receipts describe that history by value; remove them with it.
	await client
		.delete(completedWorkOperation)
		.where(
			and(
				eq(completedWorkOperation.organizationId, input.organizationId),
				eq(completedWorkOperation.employeeId, input.employeeId),
			),
		);
	return {
		workPeriodsDeleted: erased.workPeriodsDeleted,
		workPeriodsWithCategory: erased.workPeriodsWithCategory,
		timeEntriesDeleted: erased.timeEntriesDeleted,
	};
}
/**
 * Removes the whole time history of each employee, one coordinated transaction per
 * employee (see `deleteDemoEmployeeHistory`), and sums what was removed.
 */
export async function deleteDemoEmployeeHistories(input: {
	organizationId: string;
	triggeringUserId: string | null;
	employeeIds: readonly string[];
}): Promise<DemoHistoryDeletion> {
	const total: DemoHistoryDeletion = {
		workPeriodsDeleted: 0,
		workPeriodsWithCategory: 0,
		timeEntriesDeleted: 0,
	};
	for (const employeeId of input.employeeIds) {
		const deleted = await withDemoWorkTransaction(
			{
				organizationId: input.organizationId,
				triggeringUserId: input.triggeringUserId,
				employeeIds: [employeeId],
			},
			(scope) =>
				deleteDemoEmployeeHistory(scope, { organizationId: input.organizationId, employeeId }),
		);
		total.workPeriodsDeleted += deleted.workPeriodsDeleted;
		total.workPeriodsWithCategory += deleted.workPeriodsWithCategory;
		total.timeEntriesDeleted += deleted.timeEntriesDeleted;
	}
	return total;
}
