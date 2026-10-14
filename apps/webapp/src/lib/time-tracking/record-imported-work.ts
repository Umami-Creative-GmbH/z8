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
 * is held instead of guessed. Completed work is created through work records\r\n * (#1223), which the legacy import-review committer uses as well; the import\r\n * worker loads its `server-only` modules through the worker preload.
 */
import { and, asc, eq, gt, isNull, lt, notExists, or, type SQL } from "drizzle-orm";
import { completedWorkOperation, employee, timeRecord, workPeriod } from "@/db/schema";
import type { CompletedWorkOperationKind } from "@/db/schema/completed-work";
import {
	dateFromInstant,
	type Instant,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import type { ImportProvider } from "@/lib/import-review/types";
import { closedRangeTouchedByWork } from "./closed-months/rules";
import { closedRangesForEmployee } from "./closed-months/store";
import { sendBackChangedPeriodSubmissions } from "./period-submissions/submission-send-back";
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
import { resolveFallbackTimezoneCapture, type TimeEntryTimezoneCapture } from "./timezone-capture";
import {
	BillableWorkRefusedError,
	readProjectBillability,
	resolveWorkBillability,
} from "./work-billability";
import { applyWorkRecordChange, type NewWorkCreation, orRefuse } from "./work-records";
import type { SealedWorkTransactionScope } from "./work-transaction";

export const IMPORTED_WORK_COMMAND_VERSION = 1;
export const IMPORTED_WORK_RESULT_VERSION = 1;
export const REVIEWED_IMPORT_WRITER_VERSION = 1;

/** Where the imported row came from: its staging identity and provider source. */
export type ImportedWorkSource = {
	provider: ImportProvider;
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
	/**
	 * The Z8 project the reviewed row is attributed to (#900; mapped by #907).
	 * Absent from commands built before project attribution, so their frozen
	 * receipts still replay; such work has no project and is never billable.
	 */
	attribution?: ImportedWorkAttribution;
};

/** An imported row's project and, when the import states it, its billability. */
export type ImportedWorkAttribution = {
	projectId: string;
	/** Absent takes the project's billable default. */
	billable?: boolean;
	/**
	 * A provider's billable value is a request, not an override (#907): when the
	 * project cannot carry billable work at commit time (no customer, or it was
	 * deleted since the scan), the row imports as non-billable instead of being held.
	 * Absent: a refused billable value holds the row.
	 */
	nonBillableWhenRefused?: true;
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
		timezoneSource: TimeEntryTimezoneCapture["timezoneSource"];
	};
	providerEvidence: ImportedWorkProviderEvidence;
	/** Absent on receipts of unattributed imports (#900): no project, non-billable. */
	attribution?: { projectId: string; isBillable: boolean };
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
	scope: SealedWorkTransactionScope,
	input: { organizationId: string; employeeId: string; command: ImportedWorkCommand },
): Promise<ImportedWorkOutcome | null> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	const [receipt] = await scope.db
		.select()
		.from(completedWorkOperation)
		.where(
			and(
				eq(completedWorkOperation.id, input.command.operationId),
				eq(completedWorkOperation.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!receipt) return null;
	const collision: ImportedWorkOutcome = { kind: "held", hold: { reason: "operation_collision" } };
	if (
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
	scope: SealedWorkTransactionScope,
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
	const attribution = await resolveImportedAttribution(tx, organizationId, command.attribution);
	if (attribution.kind === "held") return attribution;
	const { recorded } = attribution;

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

	const outcome = await (interval.kind === "completed"
		? recordCompletedImport(scope, input, { start: interval.start, end: interval.end }, recorded)
		: recordOpenImport(scope, input, interval.start, recorded));
	if (outcome.kind === "held") return outcome;
	const { written, followUps } = outcome;

	const result: ImportedWorkResult = {
		version: IMPORTED_WORK_RESULT_VERSION,
		operationId: command.operationId,
		owner: { employeeId },
		actors: { importing: { kind: "human", userId: input.importerUserId } },
		source: command.source,
		workPeriodId: written.workPeriodId,
		clockInEntryId: written.clockIn.entryId,
		clockOutEntryId: written.clockOut?.entryId ?? null,
		canonicalRecordId: written.canonicalRecordId,
		segment: {
			startAt: instantToCanonicalString(interval.start),
			endAt: interval.kind === "completed" ? instantToCanonicalString(interval.end) : null,
			durationMinutes: written.durationMinutes,
			...importedCapture(interval.start),
		},
		providerEvidence: command.providerEvidence,
		...(recorded ? { attribution: recorded } : {}),
		revisions: { workPeriod: { source: null, result: written.revision } },
		append: {
			admission: "append",
			previousEntryId: written.clockIn.previousEntryId,
			previousHash: written.clockIn.previousHash,
			tipEntryId: (written.clockOut ?? written.clockIn).entryId,
		},
		approvalState: "approved",
		approval: { participation: "none" },
		followUps,
	};
	await tx.insert(completedWorkOperation).values({
		id: command.operationId,
		organizationId,
		employeeId,
		kind: interval.kind === "completed" ? "import_completed_work" : "import_open_work",
		writer: "reviewed_import",
		writerVersion: REVIEWED_IMPORT_WRITER_VERSION,
		commandVersion: command.version,
		command,
		appendAdmission: "append",
		actorKind: "human",
		actorUserId: input.importerUserId,
		workPeriodId: written.workPeriodId,
		resultVersion: IMPORTED_WORK_RESULT_VERSION,
		result,
		sourceKey,
	});
	return { kind: "executed", result };
}

type ImportedEntryEvidence = {
	entryId: string;
	previousEntryId: string | null;
	previousHash: string | null;
};

type RecordedImport =
	| {
			kind: "recorded";
			written: {
				workPeriodId: string;
				canonicalRecordId: string | null;
				durationMinutes: number | null;
				revision: number;
				clockIn: ImportedEntryEvidence;
				clockOut: ImportedEntryEvidence | null;
			};
			followUps: ImportedWorkFollowUp[];
	  }
	| { kind: "held"; hold: ImportedWorkHold };

// Providers send UTC instants; the event-local offset is not established, so
// entries keep the legacy import capture through the shared fallback helper.
function importedCapture(instant: Instant): TimeEntryTimezoneCapture {
	return resolveFallbackTimezoneCapture({
		timestamp: dateFromInstant(instant),
		timezone: "UTC",
		timezoneSource: "backfill",
	});
}

/**
 * Imported completed work, created through work records in either admission
 * (#1223): both entries, the closed work period and its canonical work record in
 * agreement, with the effects. Occupied work, a closed month (#762), an invalid
 * interval and an append position needing review hold the row; nothing is written.
 * The legacy import-review committer calls it too, without a receipt.
 */
export async function createImportedCompletedWork(
	scope: SealedWorkTransactionScope,
	input: {
		organizationId: string;
		employeeId: string;
		importerUserId: string;
		start: Instant;
		end: Instant;
		/** The resolved project attribution (`resolveImportedAttribution`); null records none. */
		recorded: { projectId: string; isBillable: boolean } | null;
	},
): Promise<
	{ kind: "created"; creation: NewWorkCreation } | { kind: "held"; hold: ImportedWorkHold }
> {
	const created = await applyWorkRecordChange(scope, {
		kind: "create_new",
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		start: { at: input.start, notes: null, capture: importedCapture(input.start) },
		end: { at: input.end, notes: null, capture: importedCapture(input.end) },
		...(input.recorded
			? {
					attribution: {
						project: { projectId: input.recorded.projectId, billableDefault: false },
						billable: input.recorded.isBillable,
					},
				}
			: {}),
		approval: { state: "approved" },
		origin: "import",
		recordedBy: input.importerUserId,
		actorUserId: input.importerUserId,
		entries: { createdBy: input.importerUserId, ipAddress: null, deviceInfo: null },
		appendOperation: "reviewed_import",
	});
	switch (created.kind) {
		case "work_occupied":
			return {
				kind: "held",
				hold: {
					reason: "occupancy_conflict",
					occupants: created.occupants.map((occupant) => ({
						kind: occupant.kind,
						id: occupant.id,
						startAt: dateFromInstant(occupant.startAt).toISOString(),
						endAt: occupant.endAt ? dateFromInstant(occupant.endAt).toISOString() : null,
					})),
				},
			};
		case "month_closed":
			return { kind: "held", hold: { reason: "month_closed", month: created.month } };
		case "append_review_required":
			return {
				kind: "held",
				hold: { reason: "append_review_required", reasons: created.requirement.reasons },
			};
		case "interval_invalid":
			return { kind: "held", hold: { reason: "invalid_interval", detail: "non_positive" } };
	}
	return { kind: "created", creation: orRefuse<NewWorkCreation>(created) };
}

async function recordCompletedImport(
	scope: SealedWorkTransactionScope,
	input: RecordImportedWorkInput,
	interval: { start: Instant; end: Instant },
	recorded: { projectId: string; isBillable: boolean } | null,
): Promise<RecordedImport> {
	const created = await createImportedCompletedWork(scope, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		importerUserId: input.importerUserId,
		...interval,
		recorded,
	});
	if (created.kind === "held") return created;
	const { creation } = created;
	return {
		kind: "recorded",
		written: {
			workPeriodId: creation.segment.workPeriodId,
			canonicalRecordId: creation.segment.canonicalRecordId,
			durationMinutes: creation.segment.durationMinutes,
			revision: creation.after.revision,
			clockIn: creation.appended.clockIn,
			clockOut: creation.appended.clockOut,
		},
		followUps: [
			{
				kind: "work_balance_refresh",
				delivery: "committed_intent",
				dirtyFromDate: creation.effects.workBalanceDirtyFromDate,
			},
		],
	};
}

/**
 * Imported open work is live work (ADR 0002): one clock-in entry and an active
 * period, no canonical work record until it is clocked out.
 */
async function recordOpenImport(
	scope: SealedWorkTransactionScope,
	input: RecordImportedWorkInput,
	start: Instant,
	recorded: { projectId: string; isBillable: boolean } | null,
): Promise<RecordedImport> {
	const tx = scope.db;
	const { organizationId, employeeId } = input;
	const occupants = await findOccupants(tx, { organizationId, employeeId }, start, null);
	if (occupants.length > 0) {
		return { kind: "held", hold: { reason: "occupancy_conflict", occupants } };
	}
	// Imported work touching a closed month is held for review, never written (#762).
	const closed = closedRangeTouchedByWork(
		[{ start, end: null }],
		await closedRangesForEmployee(tx, { organizationId, employeeId }),
	);
	if (closed) return { kind: "held", hold: { reason: "month_closed", month: closed.month } };
	const entryInput: ClockingInput = {
		employeeId,
		organizationId,
		createdBy: input.importerUserId,
		action: { instant: start, ...importedCapture(start) },
		source: { ipAddress: null, deviceInfo: null },
	};
	let appended: AppendedClockEntry[];
	try {
		appended = await appendAdmittedClockEntries(
			createDatabaseClockingStore(tx),
			"reviewed_import",
			[{ input: entryInput, type: "clock_in" }],
		);
	} catch (error) {
		if (!(error instanceof TimeEntryAppendReviewRequiredError)) throw error;
		return {
			kind: "held",
			hold: { reason: "append_review_required", reasons: error.requirement.reasons },
		};
	}
	const [clockIn] = appended;
	if (!clockIn) throw new Error("Imported work has no clock-in entry");
	// Imported live work in a submitted period sends it back to the employee (#1062).
	await sendBackChangedPeriodSubmissions(tx, {
		organizationId,
		employeeId,
		causedByUserId: input.importerUserId,
		work: [{ start, end: start }],
	});
	const revision = 1;
	const [period] = await tx
		.insert(workPeriod)
		.values({
			employeeId,
			organizationId,
			clockInId: clockIn.entry.id,
			startTime: dateFromInstant(start),
			isActive: true,
			approvalStatus: "approved",
			projectId: recorded?.projectId ?? null,
			isBillable: recorded?.isBillable ?? false,
			graphRevision: revision,
		})
		.returning({ id: workPeriod.id });
	if (!period) throw new Error("Failed to create imported work period");
	return {
		kind: "recorded",
		written: {
			workPeriodId: period.id,
			canonicalRecordId: null,
			durationMinutes: null,
			revision,
			clockIn: {
				entryId: clockIn.entry.id,
				previousEntryId: clockIn.previousEntryId,
				previousHash: clockIn.previousHash,
			},
			clockOut: null,
		},
		followUps: [],
	};
}

/**
 * The project and billability an imported row records (#900). The project must be
 * the organization's; billability follows the project's billable default unless
 * the command states it, and billable work needs a project with a customer. A
 * refusal holds the row before anything is written, unless the billable value is
 * a provider's request (`nonBillableWhenRefused`): then the row records non-billable.
 */
export async function resolveImportedAttribution(
	tx: SealedWorkTransactionScope["db"],
	organizationId: string,
	requested: ImportedWorkAttribution | undefined,
): Promise<
	| { kind: "resolved"; recorded: { projectId: string; isBillable: boolean } | null }
	| { kind: "held"; hold: ImportedWorkHold }
> {
	if (!requested) return { kind: "resolved", recorded: null };
	const facts = await readProjectBillability(tx, organizationId, requested.projectId);
	if (!facts) {
		return {
			kind: "held",
			hold: { reason: "attribution_not_allowed", detail: "project_not_found" },
		};
	}
	try {
		const isBillable = resolveWorkBillability({
			project: facts,
			projectChosen: true,
			current: false,
			requested: requested.billable,
		});
		return { kind: "resolved", recorded: { projectId: facts.projectId, isBillable } };
	} catch (error) {
		if (!(error instanceof BillableWorkRefusedError)) throw error;
		if (requested.nonBillableWhenRefused) {
			return { kind: "resolved", recorded: { projectId: facts.projectId, isBillable: false } };
		}
		return { kind: "held", hold: { reason: "attribution_not_allowed", detail: error.reason } };
	}
}

/**
 * Symmetric half-open occupancy (#256 §4): nondeleted work in any approval state
 * occupies its interval, active work from its start onward, adjacency is valid.
 * A canonical record linked from any period is represented by that period, so
 * one work segment is never counted twice and deleted work stays excluded.
 */
async function findOccupants(
	tx: SealedWorkTransactionScope["db"],
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
