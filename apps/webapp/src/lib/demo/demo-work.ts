import "server-only";

/**
 * Runtime demo work adapter (#285 / T21, design #256/#262).
 *
 * Demo generation, correction and cleanup are runtime writers of the employee work
 * graph, so they take the shared work coordination: the organization adoption gate
 * (reading the append control under it), organization configuration, the
 * triggering admin's configuration/access guard and the sorted employee keys.
 *
 * Organizations without an active append control keep the established demo writes:
 * latest-created head selection, periods without canonical records and no
 * receipts. The only legacy changes are atomicity per employee-day and distinct
 * creation times, so later latest-created readers never see tied demo rows.
 *
 * In an adopted organization every fresh demo entry is admitted through the internal
 * append collaborator, overlapping work is left untouched, and each generated
 * session is persisted as complete work: linked entries, a closed period,
 * canonical base/detail, the committed balance refresh intent and a
 * `completed_work_operation` receipt. The receipt names the demo generator as the
 * executing system actor (no actor user) and records the triggering admin in its
 * result. Demo
 * generation is unkeyed, so its receipts are evidence, never replay identities.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	approvalRequest,
	completedWorkOperation,
	timeEntry,
	timeEntryAppendPosition,
	timeRecord,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import {
	type AppendReviewRequirement,
	admitTimeEntryAppend,
	type TimeEntryAppend,
} from "@/lib/time-tracking/time-entry-append";
import { resolveFallbackTimezoneCapture } from "@/lib/time-tracking/timezone-capture";
import { deriveWorkDurationMinutes } from "@/lib/time-tracking/work-duration";
import {
	acquireAdoptionGate,
	acquireEmployeeCoordination,
	acquireOrganizationConfigurationGuard,
	acquireUserConfigurationAccessGuards,
	readAppendAdmission,
	sealWorkTransactionScope,
	type WorkTransactionClient,
	type WorkTransactionScope,
} from "@/lib/time-tracking/work-transaction";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

type DemoWorkTransaction = Pick<Transaction, "execute" | "select"> & WorkTransactionClient;

/**
 * Acquires the shared work protocol on a transaction the caller already owns and
 * returns its scope, valid only inside that transaction. `afterAdoptionGate` takes
 * approval gates, which the protocol orders between the adoption gate and the
 * configuration guards.
 */
export async function acquireDemoWorkScope(
	transaction: DemoWorkTransaction,
	input: DemoWorkCoordinationInput,
	options: { afterAdoptionGate?: () => Promise<void> } = {},
	isActive: () => boolean = () => true,
): Promise<WorkTransactionScope> {
	await acquireAdoptionGate(transaction, input.organizationId);
	const admission = await readAppendAdmission(transaction, input.organizationId);
	await options.afterAdoptionGate?.();
	await acquireOrganizationConfigurationGuard(transaction, input.organizationId);
	await acquireUserConfigurationAccessGuards(transaction, [
		...(input.triggeringUserId ? [input.triggeringUserId] : []),
		...(input.accessUserIds ?? []),
	]);
	await acquireEmployeeCoordination(transaction, input.employeeIds);

	const employees = new Set(input.employeeIds);
	return sealWorkTransactionScope({
		db: transaction,
		admission,
		assertEmployee(organizationId: string, employeeId: string) {
			if (!isActive()) throw new Error("Work transaction is no longer active");
			if (organizationId !== input.organizationId || !employees.has(employeeId)) {
				throw new Error("Employee scope is outside the work transaction");
			}
		},
	});
}

/** One coordinated transaction for a demo operation. */
export function withDemoWorkTransaction<T>(
	input: DemoWorkCoordinationInput,
	operation: (scope: WorkTransactionScope) => Promise<T>,
): Promise<T> {
	return db.transaction(async (transaction) => {
		let active = true;
		try {
			return await operation(await acquireDemoWorkScope(transaction, input, {}, () => active));
		} finally {
			active = false;
		}
	});
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
function demoCapture(timestamp: Date) {
	return resolveFallbackTimezoneCapture({
		timestamp,
		timezone: "UTC",
		timezoneSource: "backfill",
	});
}

/**
 * Persists one employee-day of generated sessions in the caller's coordinated
 * transaction. The caller owns the transaction, so a failure rolls back the day.
 */
export async function recordDemoWorkDay(
	scope: WorkTransactionScope,
	input: DemoWorkDayInput,
): Promise<DemoWorkDayOutcome> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	if (input.sessions.length === 0) {
		return { kind: "recorded", timeEntriesCreated: 0, workPeriodsCreated: 0 };
	}
	return scope.admission === "append"
		? recordAdoptedDemoWorkDay(scope, input)
		: recordLegacyDemoWorkDay(scope.db, input);
}

type LinkedEntry = { id: string; hash: string };

async function insertDemoEntry(
	client: WorkTransactionClient,
	input: DemoWorkDayInput,
	values: {
		type: "clock_in" | "clock_out";
		instant: Instant;
		notes: string;
		predecessor: LinkedEntry | null;
	},
) {
	const timestamp = dateFromInstant(values.instant);
	const previousHash = values.predecessor?.hash ?? null;
	const capture = demoCapture(timestamp);
	const [entry] = await client
		.insert(timeEntry)
		.values({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			type: values.type,
			timestamp,
			hash: calculateHash({
				employeeId: input.employeeId,
				type: values.type,
				timestamp: timestamp.toISOString(),
				previousHash,
			}),
			previousHash,
			previousEntryId: values.predecessor?.id ?? null,
			notes: values.notes,
			createdBy: input.triggeringUserId,
			// Rows written in one transaction would otherwise share `now()`; distinct
			// creation times keep latest-created readers from seeing ties.
			createdAt: sql`clock_timestamp()`,
			...capture,
		})
		.returning();
	if (!entry) throw new Error("Failed to create demo time entry");
	return { entry, capture };
}

async function recordLegacyDemoWorkDay(
	client: WorkTransactionClient,
	input: DemoWorkDayInput,
): Promise<DemoWorkDayOutcome> {
	// Established legacy head selection: the employee's latest-created entry.
	const [head] = await client
		.select({ id: timeEntry.id, hash: timeEntry.hash })
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, input.organizationId),
				eq(timeEntry.employeeId, input.employeeId),
			),
		)
		.orderBy(desc(timeEntry.createdAt))
		.limit(1);
	let predecessor: LinkedEntry | null = head ?? null;
	for (const session of input.sessions) {
		const clockIn = await insertDemoEntry(client, input, {
			type: "clock_in",
			instant: session.start,
			notes: session.clockInNotes,
			predecessor,
		});
		const clockOut = await insertDemoEntry(client, input, {
			type: "clock_out",
			instant: session.end,
			notes: session.clockOutNotes,
			predecessor: clockIn.entry,
		});
		predecessor = clockOut.entry;
		await client.insert(workPeriod).values({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			clockInId: clockIn.entry.id,
			clockOutId: clockOut.entry.id,
			startTime: clockIn.entry.timestamp,
			endTime: clockOut.entry.timestamp,
			// Demo endpoints are whole minutes, so this equals the established rounding.
			durationMinutes: deriveWorkDurationMinutes(session.start, session.end),
			isActive: false,
		});
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

async function recordAdoptedDemoWorkDay(
	scope: WorkTransactionScope,
	input: DemoWorkDayInput,
): Promise<DemoWorkDayOutcome> {
	const client = scope.db;
	if (await isOccupied(client, input)) return { kind: "occupied" };
	const admitted = await admitTimeEntryAppend(
		client,
		{ organizationId: input.organizationId, employeeId: input.employeeId },
		"demo_generation",
	);
	if (admitted.kind === "review_required") {
		return { kind: "held_for_review", requirement: admitted.requirement };
	}
	const append = admitted.append;
	for (const [sessionIndex, session] of input.sessions.entries()) {
		const operationId = randomUUID();
		const durationMinutes = deriveWorkDurationMinutes(session.start, session.end);
		const clockIn = await appendDemoEntry(client, append, input, {
			type: "clock_in",
			instant: session.start,
			notes: session.clockInNotes,
		});
		const clockOut = await appendDemoEntry(client, append, input, {
			type: "clock_out",
			instant: session.end,
			notes: session.clockOutNotes,
		});
		const [record] = await client
			.insert(timeRecord)
			.values({
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				recordKind: "work",
				startAt: clockIn.entry.timestamp,
				endAt: clockOut.entry.timestamp,
				durationMinutes,
				approvalState: "approved",
				origin: "clock",
				createdBy: input.triggeringUserId,
				updatedBy: input.triggeringUserId,
			})
			.returning({ id: timeRecord.id });
		if (!record) throw new Error("Failed to create demo canonical work record");
		await client.insert(timeRecordWork).values({
			recordId: record.id,
			organizationId: input.organizationId,
			recordKind: "work",
			workCategoryId: null,
			workLocationType: null,
			computationMetadata: null,
		});
		const [period] = await client
			.insert(workPeriod)
			.values({
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				clockInId: clockIn.entry.id,
				clockOutId: clockOut.entry.id,
				startTime: clockIn.entry.timestamp,
				endTime: clockOut.entry.timestamp,
				durationMinutes,
				isActive: false,
				canonicalRecordId: record.id,
				approvalStatus: "approved",
			})
			.returning({ id: workPeriod.id, graphRevision: workPeriod.graphRevision });
		if (!period) throw new Error("Failed to create demo work period");

		const dirtyFromDate = utcDate(session.start);
		const result: DemoWorkResult = {
			version: DEMO_WORK_RESULT_VERSION,
			operationId,
			owner: { employeeId: input.employeeId },
			actors: {
				executing: { kind: "system", process: "runtime_demo" },
				triggeredBy: { kind: "human", userId: input.triggeringUserId },
			},
			workPeriodId: period.id,
			clockInEntryId: clockIn.entry.id,
			clockOutEntryId: clockOut.entry.id,
			canonicalRecordId: record.id,
			segment: {
				startAt: instantToCanonicalString(session.start),
				endAt: instantToCanonicalString(session.end),
				durationMinutes,
				startUtcOffsetMinutes: clockIn.capture.utcOffsetMinutes,
				endUtcOffsetMinutes: clockOut.capture.utcOffsetMinutes,
				timezone: clockOut.capture.timezone,
				timezoneSource: "backfill",
			},
			attribution: { projectId: null, workCategoryId: null, workLocationType: null },
			revisions: { workPeriod: { source: null, result: period.graphRevision } },
			append: {
				admission: "append",
				clockIn: clockIn.link,
				clockOut: {
					previousEntryId: clockIn.entry.id,
					previousHash: clockIn.entry.hash,
				},
			},
			approvalState: "approved",
			approval: { participation: "none" },
			followUps: [{ kind: "work_balance_refresh", delivery: "committed_intent", dirtyFromDate }],
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
			workPeriodId: period.id,
			resultVersion: DEMO_WORK_RESULT_VERSION,
			result,
		});
	}
	// Required recalculation commits with the work (UTC capture, so the UTC date).
	const earliestStart = input.sessions
		.map((session) => session.start)
		.reduce((earliest, start) => (compareInstants(start, earliest) < 0 ? start : earliest));
	await markEmployeeWorkBalanceDirty(
		{
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			dirtyFromDate: utcDate(earliestStart),
		},
		client,
	);
	return {
		kind: "recorded",
		timeEntriesCreated: input.sessions.length * 2,
		workPeriodsCreated: input.sessions.length,
	};
}

function utcDate(instant: Instant): string {
	return instant.toZonedDateTimeISO("UTC").toPlainDate().toString();
}

async function appendDemoEntry(
	client: WorkTransactionClient,
	append: TimeEntryAppend,
	input: DemoWorkDayInput,
	values: { type: "clock_in" | "clock_out"; instant: Instant; notes: string },
) {
	const predecessor = append.predecessor;
	const inserted = await insertDemoEntry(client, input, { ...values, predecessor });
	const link = {
		previousEntryId: predecessor?.id ?? null,
		previousHash: predecessor?.hash ?? null,
	};
	await append.record({ id: inserted.entry.id, hash: inserted.entry.hash, ...link });
	return { ...inserted, link };
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * Assigns a demo work category to one completed period. Legacy organizations keep
 * the established period-only update. An adopted organization changes only
 * settled work (approved, undeleted, nothing pending), updates the canonical work
 * detail with it and advances the period's graph revision.
 */
export async function assignDemoWorkCategory(
	scope: WorkTransactionScope,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		workCategoryId: string;
	},
): Promise<boolean> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	const client = scope.db;
	const inScope = and(
		eq(workPeriod.id, input.workPeriodId),
		eq(workPeriod.organizationId, input.organizationId),
		eq(workPeriod.employeeId, input.employeeId),
	);
	if (scope.admission !== "append") {
		const updated = await client
			.update(workPeriod)
			.set({ workCategoryId: input.workCategoryId })
			.where(inScope)
			.returning({ id: workPeriod.id });
		return updated.length === 1;
	}
	const [period] = await client.select().from(workPeriod).where(inScope).for("update").limit(1);
	if (
		!period ||
		period.isActive ||
		period.deletedAt !== null ||
		period.approvalStatus !== "approved" ||
		period.pendingChanges !== null ||
		!period.canonicalRecordId
	) {
		return false;
	}
	const detail = await client
		.update(timeRecordWork)
		.set({ workCategoryId: input.workCategoryId })
		.where(
			and(
				eq(timeRecordWork.recordId, period.canonicalRecordId),
				eq(timeRecordWork.organizationId, input.organizationId),
			),
		)
		.returning({ recordId: timeRecordWork.recordId });
	if (detail.length !== 1) return false;
	const [updated] = await client
		.update(workPeriod)
		.set({ workCategoryId: input.workCategoryId, graphRevision: period.graphRevision + 1 })
		.where(and(inScope, eq(workPeriod.graphRevision, period.graphRevision)))
		.returning({ id: workPeriod.id });
	if (!updated) throw new Error("Demo work period changed during category assignment");
	return true;
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
 * append position, receipts, periods and entries. In an adopted scope it also
 * removes the periods' canonical work records (except those a retained approval
 * request references) and commits the balance refresh intent. No other employee or
 * organization is touched.
 */
export async function deleteDemoEmployeeHistory(
	scope: WorkTransactionScope,
	input: { organizationId: string; employeeId: string },
): Promise<DemoHistoryDeletion> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	const client = scope.db;
	// The append position references its tip entry; remove it with the history.
	await client
		.delete(timeEntryAppendPosition)
		.where(
			and(
				eq(timeEntryAppendPosition.organizationId, input.organizationId),
				eq(timeEntryAppendPosition.employeeId, input.employeeId),
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
	const periods = await client
		.delete(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
			),
		)
		.returning({
			canonicalRecordId: workPeriod.canonicalRecordId,
			workCategoryId: workPeriod.workCategoryId,
			startTime: workPeriod.startTime,
		});
	const canonicalRecordIds = periods.flatMap((period) =>
		period.canonicalRecordId ? [period.canonicalRecordId] : [],
	);
	// Adopted scopes also remove the linked canonical work and commit the balance
	// refresh intent for it; legacy cleanup keeps its established rows.
	if (scope.admission === "append" && canonicalRecordIds.length > 0) {
		await client.delete(timeRecord).where(
			and(
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.employeeId, input.employeeId),
				eq(timeRecord.recordKind, "work"),
				inArray(timeRecord.id, canonicalRecordIds),
				notExists(
					client
						.select({ id: approvalRequest.id })
						.from(approvalRequest)
						.where(
							and(
								eq(approvalRequest.organizationId, timeRecord.organizationId),
								eq(approvalRequest.canonicalRecordId, timeRecord.id),
							),
						),
				),
			),
		);
	}
	const entries = await client
		.delete(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, input.organizationId),
				eq(timeEntry.employeeId, input.employeeId),
			),
		)
		.returning({ id: timeEntry.id });
	const earliestStart = periods.reduce<Date | null>(
		(earliest, period) =>
			earliest === null || period.startTime < earliest ? period.startTime : earliest,
		null,
	);
	if (scope.admission === "append" && earliestStart) {
		await markEmployeeWorkBalanceDirty(
			{
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				dirtyFromDate: utcDate(instantFromDate(earliestStart)),
			},
			client,
		);
	}
	return {
		workPeriodsDeleted: periods.length,
		workPeriodsWithCategory: periods.filter((period) => period.workCategoryId !== null).length,
		timeEntriesDeleted: entries.length,
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
