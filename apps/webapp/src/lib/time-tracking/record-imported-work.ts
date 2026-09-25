/**
 * Completed-work operation for reviewed imports (#284 / T20, design #256).
 *
 * The reviewed-import worker calls it inside its outer transaction
 * (`withReviewedImportTransaction`) for organizations whose append control is
 * active. One call either commits the whole imported graph or holds the row for
 * review with nothing written:
 *
 * - an open appender: one clock-in entry and an active period;
 * - a completed segment: clock-in and clock-out entries, the closed period, the
 *   canonical base and work detail, and the work-balance refresh intent.
 *
 * Entries advance the employee's append position from one evidence-based
 * admission. The import-row identity is the operation identity; the provider
 * source is recorded once per organization, so a re-import cannot recreate work.
 * Fresh minutes come from the exact UTC endpoints; provider-stated durations are
 * kept as evidence, and an interpretation that would change the worked interval
 * is held instead of guessed. Free of `server-only`: the import worker runs it.
 */
import { and, asc, eq, gt, isNull, lt, notExists, or, type SQL } from "drizzle-orm";
import {
	completedWorkOperation,
	employee,
	timeRecord,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import type { CompletedWorkOperationKind } from "@/db/schema/completed-work";
import {
	dateFromInstant,
	type Instant,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { canonicalJson } from "./canonical-json";
import {
	type AppendedClockEntry,
	appendAdmittedClockEntries,
	type ClockingInput,
	createDatabaseClockingStore,
	TimeEntryAppendReviewRequiredError,
} from "./clocking-core";
import {
	type ImportedWorkHold,
	type ImportedWorkOccupant,
	type ImportedWorkProviderEvidence,
	interpretImportedWorkInterval,
} from "./imported-work-interval";
import type { WorkTransactionScope } from "./work-transaction";

export const IMPORTED_WORK_COMMAND_VERSION = 1;
export const IMPORTED_WORK_RESULT_VERSION = 1;
export const REVIEWED_IMPORT_WRITER_VERSION = 1;

/** Where the imported row came from: its staging identity and provider source. */
export type ImportedWorkSource = {
	provider: "clockodo" | "clockin";
	batchId: string;
	entityType: "work_period";
	providerSourceId: string;
	sourcePayloadHash: string;
};

/** Versioned request evidence built from the reviewed staging row. */
export type ImportedWorkCommand = {
	version: typeof IMPORTED_WORK_COMMAND_VERSION;
	/** The staged import row ID. */
	operationId: string;
	source: ImportedWorkSource;
	/** Provider endpoints exactly as reviewed; `endsAt` is null for open work. */
	startsAt: string;
	endsAt: string | null;
	providerEvidence: ImportedWorkProviderEvidence;
};

export type ImportedWorkFollowUp = {
	kind: "work_balance_refresh";
	delivery: "committed_intent";
	dirtyFromDate: string;
};

/** Committed result (receipt version 1). Current state is a separate read. */
export type ImportedWorkResult = {
	version: typeof IMPORTED_WORK_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	/** The human who committed the reviewed import; provider actors are source evidence. */
	actors: { importing: { kind: "human"; userId: string } };
	source: ImportedWorkSource;
	workPeriodId: string;
	clockInEntryId: string;
	clockOutEntryId: string | null;
	canonicalRecordId: string | null;
	segment: {
		startAt: string;
		endAt: string | null;
		durationMinutes: number | null;
		utcOffsetMinutes: number;
		timezone: string;
		timezoneSource: "backfill";
	};
	providerEvidence: ImportedWorkProviderEvidence;
	revisions: { workPeriod: { source: null; result: number } };
	append: {
		admission: "append";
		previousEntryId: string | null;
		previousHash: string | null;
		tipEntryId: string;
	};
	approvalState: "approved";
	approval: { participation: "none" };
	followUps: ImportedWorkFollowUp[];
};

export type ImportedWorkOutcome =
	| { kind: "executed" | "replayed"; result: ImportedWorkResult }
	| { kind: "held"; hold: ImportedWorkHold };

export type RecordImportedWorkInput = {
	organizationId: string;
	employeeId: string;
	/** The authenticated human who committed the reviewed batch. */
	importerUserId: string;
	command: ImportedWorkCommand;
	/** Authoritative instant sampled once for this attempt. */
	now: Instant;
};

const IMPORT_KINDS: readonly CompletedWorkOperationKind[] = [
	"import_completed_work",
	"import_open_work",
];

/** One committed operation per provider source and organization. */
export function importedWorkSourceKey(source: ImportedWorkSource): string {
	return JSON.stringify([source.provider, source.entityType, source.providerSourceId]);
}

/**
 * Exact receipt replay, in every admission mode. Returns null when the identity
 * has no receipt. A different command, scope or writer under the same identity,
 * or committed work that no longer stands, is an operation collision: it is held,
 * never re-executed or repaired.
 */
export async function replayImportedWork(
	scope: WorkTransactionScope,
	input: { organizationId: string; employeeId: string; command: ImportedWorkCommand },
): Promise<ImportedWorkOutcome | null> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	const [receipt] = await scope.db
		.select()
		.from(completedWorkOperation)
		.where(eq(completedWorkOperation.id, input.command.operationId))
		.limit(1);
	if (!receipt) return null;
	const collision: ImportedWorkOutcome = { kind: "held", hold: { reason: "operation_collision" } };
	if (
		receipt.organizationId !== input.organizationId ||
		receipt.employeeId !== input.employeeId ||
		receipt.writer !== "reviewed_import" ||
		!IMPORT_KINDS.includes(receipt.kind) ||
		receipt.commandVersion !== input.command.version ||
		receipt.resultVersion !== IMPORTED_WORK_RESULT_VERSION ||
		canonicalJson(receipt.command) !== canonicalJson(input.command)
	) {
		return collision;
	}
	const result = receipt.result as ImportedWorkResult;
	const [period] = await scope.db
		.select({
			clockInId: workPeriod.clockInId,
			clockOutId: workPeriod.clockOutId,
			deletedAt: workPeriod.deletedAt,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, result.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
			),
		)
		.limit(1);
	// Later ordinary changes (an open import closed by the employee) do not
	// invalidate the receipt; deleted or relinked work does.
	if (
		!period ||
		period.deletedAt !== null ||
		period.clockInId !== result.clockInEntryId ||
		(result.clockOutEntryId !== null && period.clockOutId !== result.clockOutEntryId)
	) {
		return collision;
	}
	return { kind: "replayed", result };
}

/**
 * Fresh import. The caller has already ruled out receipt replay and runs in the
 * adopted (`append`) admission mode. Holds are returned before any write.
 */
export async function recordImportedWork(
	scope: WorkTransactionScope,
	input: RecordImportedWorkInput,
): Promise<ImportedWorkOutcome> {
	const { organizationId, employeeId, command } = input;
	scope.assertEmployee(organizationId, employeeId);
	if (scope.admission !== "append") {
		throw new Error("Reviewed imports use the operation only in adopted organizations");
	}
	const tx = scope.db;
	const [owner] = await tx
		.select({ id: employee.id })
		.from(employee)
		.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
		.limit(1);
	if (!owner) {
		throw new Error(`Employee ${employeeId} does not belong to organization ${organizationId}`);
	}

	const interval = interpretImportedWorkInterval({
		startsAt: command.startsAt,
		endsAt: command.endsAt,
		evidence: command.providerEvidence,
		now: input.now,
	});
	if (interval.kind === "held") return interval;
	const end = interval.kind === "completed" ? interval.end : null;

	const sourceKey = importedWorkSourceKey(command.source);
	const [earlier] = await tx
		.select({ id: completedWorkOperation.id })
		.from(completedWorkOperation)
		.where(
			and(
				eq(completedWorkOperation.organizationId, organizationId),
				eq(completedWorkOperation.sourceKey, sourceKey),
			),
		)
		.limit(1);
	if (earlier)
		return { kind: "held", hold: { reason: "source_collision", operationId: earlier.id } };

	const occupants = await findOccupants(tx, { organizationId, employeeId }, interval.start, end);
	if (occupants.length > 0)
		return { kind: "held", hold: { reason: "occupancy_conflict", occupants } };

	const entryInput = (instant: Instant): ClockingInput => ({
		employeeId,
		organizationId,
		createdBy: input.importerUserId,
		action: { instant, utcOffsetMinutes: 0, timezone: "UTC", timezoneSource: "backfill" },
		source: { ipAddress: null, deviceInfo: null },
	});
	let appended: AppendedClockEntry[];
	try {
		appended = await appendAdmittedClockEntries(
			createDatabaseClockingStore(tx),
			"reviewed_import",
			[
				{ input: entryInput(interval.start), type: "clock_in" },
				...(end ? [{ input: entryInput(end), type: "clock_out" as const }] : []),
			],
		);
	} catch (error) {
		if (!(error instanceof TimeEntryAppendReviewRequiredError)) throw error;
		return {
			kind: "held",
			hold: { reason: "append_review_required", reasons: error.requirement.reasons },
		};
	}
	const [clockIn, clockOut] = appended;
	if (!clockIn) throw new Error("Imported work has no clock-in entry");

	const startAt = dateFromInstant(interval.start);
	const endAt = end ? dateFromInstant(end) : null;
	const durationMinutes = interval.kind === "completed" ? interval.durationMinutes : null;
	let canonicalRecordId: string | null = null;
	if (endAt) {
		const [record] = await tx
			.insert(timeRecord)
			.values({
				organizationId,
				employeeId,
				recordKind: "work",
				startAt,
				endAt,
				durationMinutes,
				approvalState: "approved",
				origin: "import",
				createdBy: input.importerUserId,
				updatedBy: input.importerUserId,
			})
			.returning({ id: timeRecord.id });
		if (!record) throw new Error("Failed to create canonical work record");
		await tx.insert(timeRecordWork).values({
			recordId: record.id,
			organizationId,
			recordKind: "work",
			workCategoryId: null,
			workLocationType: null,
			computationMetadata: null,
		});
		canonicalRecordId = record.id;
	}

	const resultRevision = 1;
	const [period] = await tx
		.insert(workPeriod)
		.values({
			employeeId,
			organizationId,
			clockInId: clockIn.entry.id,
			clockOutId: clockOut?.entry.id ?? null,
			startTime: startAt,
			endTime: endAt,
			durationMinutes,
			isActive: endAt === null,
			approvalStatus: "approved",
			canonicalRecordId,
			graphRevision: resultRevision,
		})
		.returning({ id: workPeriod.id });
	if (!period) throw new Error("Failed to create imported work period");

	// Imported endpoints are captured in UTC; the employee's local day may start
	// on the previous UTC date, so the refresh covers it too.
	const followUps: ImportedWorkFollowUp[] = [];
	if (endAt) {
		const dirtyFromDate = interval.start
			.toZonedDateTimeISO("UTC")
			.toPlainDate()
			.subtract({ days: 1 })
			.toString();
		await markEmployeeWorkBalanceDirty({ employeeId, organizationId, dirtyFromDate }, tx);
		followUps.push({ kind: "work_balance_refresh", delivery: "committed_intent", dirtyFromDate });
	}

	const tip = appended.at(-1) ?? clockIn;
	const result: ImportedWorkResult = {
		version: IMPORTED_WORK_RESULT_VERSION,
		operationId: command.operationId,
		owner: { employeeId },
		actors: { importing: { kind: "human", userId: input.importerUserId } },
		source: command.source,
		workPeriodId: period.id,
		clockInEntryId: clockIn.entry.id,
		clockOutEntryId: clockOut?.entry.id ?? null,
		canonicalRecordId,
		segment: {
			startAt: instantToCanonicalString(interval.start),
			endAt: end ? instantToCanonicalString(end) : null,
			durationMinutes,
			utcOffsetMinutes: 0,
			timezone: "UTC",
			timezoneSource: "backfill",
		},
		providerEvidence: command.providerEvidence,
		revisions: { workPeriod: { source: null, result: resultRevision } },
		append: {
			admission: "append",
			previousEntryId: clockIn.previousEntryId,
			previousHash: clockIn.previousHash,
			tipEntryId: tip.entry.id,
		},
		approvalState: "approved",
		approval: { participation: "none" },
		followUps,
	};
	await tx.insert(completedWorkOperation).values({
		id: command.operationId,
		organizationId,
		employeeId,
		kind: endAt ? "import_completed_work" : "import_open_work",
		writer: "reviewed_import",
		writerVersion: REVIEWED_IMPORT_WRITER_VERSION,
		commandVersion: command.version,
		command,
		appendAdmission: "append",
		actorKind: "human",
		actorUserId: input.importerUserId,
		workPeriodId: period.id,
		resultVersion: IMPORTED_WORK_RESULT_VERSION,
		result,
		sourceKey,
	});
	return { kind: "executed", result };
}

/**
 * Symmetric half-open occupancy (#256 §4): nondeleted work in any approval state
 * occupies its interval, active work from its start onward, adjacency is valid.
 * A canonical record linked from any period is represented by that period, so
 * one work segment is never counted twice and deleted work stays excluded.
 */
async function findOccupants(
	tx: WorkTransactionScope["db"],
	scope: { organizationId: string; employeeId: string },
	start: Instant,
	end: Instant | null,
): Promise<ImportedWorkOccupant[]> {
	const startAt = dateFromInstant(start);
	const endAt = end ? dateFromInstant(end) : null;
	const overlaps = (
		startColumn: typeof workPeriod.startTime | typeof timeRecord.startAt,
		endColumn: typeof workPeriod.endTime | typeof timeRecord.endAt,
	): SQL[] => [
		...(endAt ? [lt(startColumn, endAt)] : []),
		or(isNull(endColumn), gt(endColumn, startAt)) as SQL,
	];
	const periods = await tx
		.select({ id: workPeriod.id, startAt: workPeriod.startTime, endAt: workPeriod.endTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
				isNull(workPeriod.deletedAt),
				...overlaps(workPeriod.startTime, workPeriod.endTime),
			),
		)
		.orderBy(asc(workPeriod.startTime), asc(workPeriod.id));
	const records = await tx
		.select({ id: timeRecord.id, startAt: timeRecord.startAt, endAt: timeRecord.endAt })
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.organizationId, scope.organizationId),
				eq(timeRecord.employeeId, scope.employeeId),
				eq(timeRecord.recordKind, "work"),
				...overlaps(timeRecord.startAt, timeRecord.endAt),
				notExists(
					tx
						.select({ id: workPeriod.id })
						.from(workPeriod)
						.where(
							and(
								eq(workPeriod.organizationId, scope.organizationId),
								eq(workPeriod.canonicalRecordId, timeRecord.id),
							),
						),
				),
			),
		)
		.orderBy(asc(timeRecord.startAt), asc(timeRecord.id));
	return [
		...periods.map((row) => ({ kind: "work_period" as const, ...occupantInterval(row) })),
		...records.map((row) => ({ kind: "time_record" as const, ...occupantInterval(row) })),
	];
}

function occupantInterval(row: { id: string; startAt: Date; endAt: Date | null }) {
	return {
		id: row.id,
		startAt: row.startAt.toISOString(),
		endAt: row.endAt?.toISOString() ?? null,
	};
}
