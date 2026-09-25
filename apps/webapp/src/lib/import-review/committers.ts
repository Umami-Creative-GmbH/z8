import { and, asc, eq, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	holiday,
	holidayCategory,
	importBatch,
	importStagedRow,
	surchargeModel,
	team,
	timeEntry,
	workCategory,
	workPeriod,
} from "@/db/schema";
import { systemClock } from "@/lib/datetime/temporal-core";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import type { ImportedWorkHold } from "@/lib/time-tracking/imported-work-interval";
import {
	type ImportedWorkCommand,
	importedWorkSourceKey,
	recordImportedWork,
	replayImportedWork,
} from "@/lib/time-tracking/record-imported-work";
import { resolveFallbackTimezoneCapture } from "@/lib/time-tracking/timezone-capture";
import { acquireExclusiveOrganizationConfigurationGuard } from "@/lib/time-tracking/work-transaction";
import { withReviewedImportTransaction } from "./import-work-transaction";
import { importedWorkProviderEvidence } from "./imported-work-evidence";
import type { ImportCommitJobData, ImportProvider } from "./types";

type CommitRowError = { rowId: string; message: string };
type CommitSummary = {
	remainingRows: number;
	totalCommittedRows: number;
	terminalFailedRows: number;
};
type CommitResult = {
	committedRows: number;
	/** Rows that failed and may succeed on a retry; held rows are not retried. */
	failedRows: number;
	/** Rows the work operation held for review, with their evidence on the row. */
	heldRows: number;
	errors: CommitRowError[];
	summary: CommitSummary;
};
type CommitOptions = { finalAttempt?: boolean };
type ChainHead = { id: string; hash: string } | null;
type CommitDb = Pick<typeof db, "execute" | "insert" | "query" | "select" | "update">;
type CommitRowOutcome =
	| { status: "committed" }
	| { status: "blocked"; message: string }
	| { status: "held"; message: string }
	| { status: "skipped" };
type BlockOptions = { finalAttempt: boolean };

interface WorkPeriodPayload {
	employeeId: string;
	startsAt: string;
	endsAt?: string | null;
}

interface AbsencePayload {
	employeeId: string;
	startsAt: string;
	endsAt: string;
	categoryName?: string | null;
	note?: string | null;
}

interface SetupReferencePayload {
	name?: string | null;
	description?: string | null;
	note?: string | null;
	active?: boolean | null;
	isActive?: boolean | null;
	factor?: string | number | null;
	color?: string | null;
	categoryId?: string | null;
	date?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	recurrenceType?: "none" | "yearly" | "custom" | null;
	recurrenceRule?: string | null;
}

async function markCommitted(
	database: CommitDb,
	rowId: string,
	job: ImportCommitJobData,
	tableName: string,
	targetId: string,
) {
	await database
		.update(importStagedRow)
		.set({
			rowStatus: "committed",
			commitTargetTable: tableName,
			commitTargetId: targetId,
			commitError: null,
		})
		.where(
			and(
				eq(importStagedRow.id, rowId),
				eq(importStagedRow.batchId, job.batchId),
				eq(importStagedRow.organizationId, job.organizationId),
				eq(importStagedRow.entityType, job.entityType),
				eq(importStagedRow.rowStatus, "committing"),
			),
		);
}

async function markBlocked(
	database: CommitDb,
	rowId: string,
	job: ImportCommitJobData,
	message: string,
) {
	await database
		.update(importStagedRow)
		.set({
			rowStatus: "blocked",
			commitError: message,
		})
		.where(
			and(
				eq(importStagedRow.id, rowId),
				eq(importStagedRow.batchId, job.batchId),
				eq(importStagedRow.organizationId, job.organizationId),
				eq(importStagedRow.entityType, job.entityType),
				eq(importStagedRow.rowStatus, "committing"),
			),
		);
}

/**
 * A row the work operation held for review keeps its evidence durably: it is
 * blocked immediately, on any attempt, because retrying cannot change the outcome.
 */
async function markHeld(
	database: CommitDb,
	rowId: string,
	job: ImportCommitJobData,
	hold: ImportedWorkHold,
): Promise<CommitRowOutcome> {
	const message = `Held for review: ${hold.reason}`;
	await database
		.update(importStagedRow)
		.set({
			rowStatus: "blocked",
			issueSeverity: "blocking",
			commitError: message,
			commitHold: hold,
		})
		.where(
			and(
				eq(importStagedRow.id, rowId),
				eq(importStagedRow.batchId, job.batchId),
				eq(importStagedRow.organizationId, job.organizationId),
				eq(importStagedRow.entityType, job.entityType),
				eq(importStagedRow.rowStatus, "committing"),
			),
		);
	return { status: "held", message };
}

async function releaseBlocked(database: CommitDb, rowId: string, job: ImportCommitJobData) {
	await database
		.update(importStagedRow)
		.set({
			rowStatus: "accepted",
			commitError: null,
		})
		.where(
			and(
				eq(importStagedRow.id, rowId),
				eq(importStagedRow.batchId, job.batchId),
				eq(importStagedRow.organizationId, job.organizationId),
				eq(importStagedRow.entityType, job.entityType),
				eq(importStagedRow.rowStatus, "committing"),
			),
		);
}

async function blockRow(
	database: CommitDb,
	rowId: string,
	job: ImportCommitJobData,
	message: string,
	options: BlockOptions,
): Promise<CommitRowOutcome> {
	if (options.finalAttempt) await markBlocked(database, rowId, job, message);
	else await releaseBlocked(database, rowId, job);
	return { status: "blocked", message };
}

async function markCommitFailed(rowId: string, job: ImportCommitJobData, error: unknown) {
	const [updated] = await db
		.update(importStagedRow)
		.set({
			rowStatus: "commit_failed",
			commitError: error instanceof Error ? error.message : String(error),
		})
		.where(
			and(
				eq(importStagedRow.id, rowId),
				eq(importStagedRow.batchId, job.batchId),
				eq(importStagedRow.organizationId, job.organizationId),
				eq(importStagedRow.entityType, job.entityType),
				eq(importStagedRow.rowStatus, "accepted"),
			),
		)
		.returning({ id: importStagedRow.id });
	return Boolean(updated);
}

async function claimRow(database: CommitDb, rowId: string, job: ImportCommitJobData) {
	const [claimed] = await database
		.update(importStagedRow)
		.set({
			rowStatus: "committing",
			commitError: null,
			// A fresh attempt replaces any earlier hold evidence with its own outcome.
			commitHold: null,
		})
		.where(
			and(
				eq(importStagedRow.id, rowId),
				eq(importStagedRow.batchId, job.batchId),
				eq(importStagedRow.organizationId, job.organizationId),
				eq(importStagedRow.entityType, job.entityType),
				eq(importStagedRow.rowStatus, "accepted"),
			),
		)
		.returning();
	return claimed ?? null;
}

async function assertEmployeeInOrganization(
	database: CommitDb,
	employeeId: string,
	organizationId: string,
) {
	const found = await database.query.employee.findFirst({
		where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
	});

	if (!found) {
		throw new Error(`Employee ${employeeId} does not belong to organization ${organizationId}`);
	}
}

async function getChainHead(
	database: CommitDb,
	employeeId: string,
	organizationId: string,
): Promise<ChainHead> {
	const result = await database.execute<{ id: string; hash: string }>(sql`
		select candidate.id, candidate.hash
		from ${timeEntry} as candidate
		where candidate.employee_id = ${employeeId}
			and candidate.organization_id = ${organizationId}
			and not exists (
				select 1
				from ${timeEntry} as child
				where child.employee_id = ${employeeId}
					and child.organization_id = ${organizationId}
					and child.previous_entry_id = candidate.id
			)
		limit 2
	`);
	const leaves = Array.isArray(result) ? result : result.rows;
	if (leaves.length > 1) {
		throw new Error(
			`Ambiguous time entry chain for employee ${employeeId} in organization ${organizationId}: multiple leaves found`,
		);
	}
	return leaves[0] ?? null;
}

async function getPersistedRowStatus(rowId: string, job: ImportCommitJobData) {
	const persisted = await db.query.importStagedRow.findFirst({
		where: and(
			eq(importStagedRow.id, rowId),
			eq(importStagedRow.batchId, job.batchId),
			eq(importStagedRow.organizationId, job.organizationId),
			eq(importStagedRow.entityType, job.entityType),
		),
		columns: { rowStatus: true },
	});
	return persisted?.rowStatus ?? null;
}

async function getCommitSummary(job: ImportCommitJobData): Promise<CommitSummary> {
	const rows = await db.query.importStagedRow.findMany({
		where: and(
			eq(importStagedRow.batchId, job.batchId),
			eq(importStagedRow.organizationId, job.organizationId),
			eq(importStagedRow.entityType, job.entityType),
		),
		columns: { rowStatus: true },
	});

	return rows.reduce<CommitSummary>(
		(summary, row) => {
			if (row.rowStatus === "accepted" || row.rowStatus === "committing") {
				summary.remainingRows++;
			} else if (row.rowStatus === "committed") {
				summary.totalCommittedRows++;
			} else if (row.rowStatus === "blocked" || row.rowStatus === "commit_failed") {
				summary.terminalFailedRows++;
			}
			return summary;
		},
		{ remainingRows: 0, totalCommittedRows: 0, terminalFailedRows: 0 },
	);
}

function parseUtcDateTime(value: string, fieldName: string): DateTime {
	const parsed = DateTime.fromISO(value, { zone: "utc" }).toUTC();
	if (!parsed.isValid) throw new Error(`Invalid ${fieldName}: ${value}`);
	return parsed;
}

function requiredName(payload: SetupReferencePayload, entityType: string) {
	const name = payload.name?.trim();
	if (!name) throw new Error(`${entityType} import row requires a name before commit`);
	return name;
}

function isActiveValue(payload: SetupReferencePayload) {
	return payload.isActive ?? payload.active ?? true;
}

/**
 * Legacy work import for organizations that have not adopted appends. It runs
 * under the reviewed-import transaction, which holds the shared employee key, and
 * keeps its established unique-leaf head selection and period-only graph.
 */
async function commitWorkPeriod(
	database: CommitDb,
	row: typeof importStagedRow.$inferSelect,
	job: ImportCommitJobData,
) {
	const payload = row.normalizedPayload as unknown as WorkPeriodPayload;
	await assertEmployeeInOrganization(database, payload.employeeId, job.organizationId);

	const startAt = parseUtcDateTime(payload.startsAt, "startsAt");
	const endAt = payload.endsAt ? parseUtcDateTime(payload.endsAt, "endsAt") : null;
	const clockInTimezoneCapture = resolveFallbackTimezoneCapture({
		timestamp: startAt.toJSDate(),
		timezone: "UTC",
		timezoneSource: "backfill",
	});
	const previous = await getChainHead(database, payload.employeeId, job.organizationId);
	const clockInHash = calculateHash({
		employeeId: payload.employeeId,
		type: "clock_in",
		timestamp: startAt.toISO()!,
		previousHash: previous?.hash ?? null,
	});
	const [clockIn] = await database
		.insert(timeEntry)
		.values({
			employeeId: payload.employeeId,
			organizationId: job.organizationId,
			type: "clock_in",
			timestamp: startAt.toJSDate(),
			previousEntryId: previous?.id ?? null,
			previousHash: previous?.hash ?? null,
			hash: clockInHash,
			createdBy: job.committedBy,
			...clockInTimezoneCapture,
		})
		.returning({ id: timeEntry.id, hash: timeEntry.hash });

	let clockOutId: string | null = null;
	let latestEntry = { id: clockIn.id, hash: clockIn.hash };
	if (endAt) {
		const clockOutTimezoneCapture = resolveFallbackTimezoneCapture({
			timestamp: endAt.toJSDate(),
			timezone: "UTC",
			timezoneSource: "backfill",
		});
		const clockOutHash = calculateHash({
			employeeId: payload.employeeId,
			type: "clock_out",
			timestamp: endAt.toISO()!,
			previousHash: latestEntry.hash,
		});
		const [clockOut] = await database
			.insert(timeEntry)
			.values({
				employeeId: payload.employeeId,
				organizationId: job.organizationId,
				type: "clock_out",
				timestamp: endAt.toJSDate(),
				previousEntryId: latestEntry.id,
				previousHash: latestEntry.hash,
				hash: clockOutHash,
				createdBy: job.committedBy,
				...clockOutTimezoneCapture,
			})
			.returning({ id: timeEntry.id, hash: timeEntry.hash });
		clockOutId = clockOut.id;
		latestEntry = { id: clockOut.id, hash: clockOut.hash };
	}

	const [period] = await database
		.insert(workPeriod)
		.values({
			employeeId: payload.employeeId,
			organizationId: job.organizationId,
			clockInId: clockIn.id,
			clockOutId,
			startTime: startAt.toJSDate(),
			endTime: endAt?.toJSDate() ?? null,
			durationMinutes: endAt ? Math.round(endAt.diff(startAt, "minutes").minutes) : null,
			isActive: !endAt,
		})
		.returning({ id: workPeriod.id });

	await markCommitted(database, row.id, job, "work_period", period.id);
}

async function ensureAbsenceCategory(
	database: CommitDb,
	organizationId: string,
	categoryName: string,
) {
	const existing = await database.query.absenceCategory.findFirst({
		where: and(
			eq(absenceCategory.organizationId, organizationId),
			eq(absenceCategory.name, categoryName),
		),
		columns: { id: true },
	});
	if (existing) return existing.id;

	const [created] = await database
		.insert(absenceCategory)
		.values({
			organizationId,
			name: categoryName,
			type: "custom",
			requiresApproval: false,
			countsAgainstVacation: false,
			isActive: true,
		})
		.returning({ id: absenceCategory.id });
	return created.id;
}

async function commitAbsence(
	database: CommitDb,
	row: typeof importStagedRow.$inferSelect,
	job: ImportCommitJobData,
) {
	const payload = row.normalizedPayload as unknown as AbsencePayload;
	await assertEmployeeInOrganization(database, payload.employeeId, job.organizationId);

	const categoryId = await ensureAbsenceCategory(
		database,
		job.organizationId,
		payload.categoryName?.trim() || "Imported absence",
	);
	const [absence] = await database
		.insert(absenceEntry)
		.values({
			employeeId: payload.employeeId,
			organizationId: job.organizationId,
			categoryId,
			startDate: parseUtcDateTime(payload.startsAt, "startsAt").toISODate()!,
			endDate: parseUtcDateTime(payload.endsAt, "endsAt").toISODate()!,
			status: "approved",
			notes: payload.note ?? null,
		})
		.returning({ id: absenceEntry.id });

	await markCommitted(database, row.id, job, "absence_entry", absence.id);
}

async function commitTeam(
	database: CommitDb,
	row: typeof importStagedRow.$inferSelect,
	job: ImportCommitJobData,
) {
	const payload = row.normalizedPayload as unknown as SetupReferencePayload;
	const [created] = await database
		.insert(team)
		.values({
			organizationId: job.organizationId,
			name: requiredName(payload, "team"),
			description: payload.description?.trim() || null,
		})
		.returning({ id: team.id });

	await markCommitted(database, row.id, job, "team", created.id);
}

async function commitWorkCategory(
	database: CommitDb,
	row: typeof importStagedRow.$inferSelect,
	job: ImportCommitJobData,
) {
	const payload = row.normalizedPayload as unknown as SetupReferencePayload;
	const [created] = await database
		.insert(workCategory)
		.values({
			organizationId: job.organizationId,
			name: requiredName(payload, "work_category"),
			description: payload.description?.trim() || payload.note?.trim() || null,
			factor: payload.factor == null ? "1.00" : String(payload.factor),
			color: payload.color?.trim() || null,
			isActive: isActiveValue(payload),
			createdBy: job.committedBy,
		})
		.returning({ id: workCategory.id });

	await markCommitted(database, row.id, job, "work_category", created.id);
}

async function commitHoliday(
	database: CommitDb,
	row: typeof importStagedRow.$inferSelect,
	job: ImportCommitJobData,
	options: BlockOptions,
): Promise<CommitRowOutcome> {
	const payload = row.normalizedPayload as unknown as SetupReferencePayload;
	if (!payload.categoryId) {
		const message = "holiday import row requires a confirmed categoryId before commit";
		return blockRow(database, row.id, job, message, options);
	}
	const category = await database.query.holidayCategory.findFirst({
		where: and(
			eq(holidayCategory.id, payload.categoryId),
			eq(holidayCategory.organizationId, job.organizationId),
		),
		columns: { id: true },
	});
	if (!category) {
		const message = `Holiday category ${payload.categoryId} does not belong to organization ${job.organizationId}`;
		return blockRow(database, row.id, job, message, options);
	}
	const startsAt = payload.startDate ?? payload.date;
	const endsAt = payload.endDate ?? startsAt;
	if (!startsAt || !endsAt) {
		const message = "holiday import row requires date or startDate before commit";
		return blockRow(database, row.id, job, message, options);
	}
	const name = payload.name?.trim();
	if (!name) {
		const message = "holiday import row requires a name before commit";
		return blockRow(database, row.id, job, message, options);
	}

	const [created] = await database
		.insert(holiday)
		.values({
			organizationId: job.organizationId,
			categoryId: payload.categoryId,
			name,
			description: payload.description?.trim() || null,
			startDate: parseUtcDateTime(startsAt, "startDate").toJSDate(),
			endDate: parseUtcDateTime(endsAt, "endDate").toJSDate(),
			recurrenceType: payload.recurrenceType ?? "none",
			recurrenceRule: payload.recurrenceRule ?? null,
			isActive: isActiveValue(payload),
			createdBy: job.committedBy,
		})
		.returning({ id: holiday.id });

	await markCommitted(database, row.id, job, "holiday", created.id);
	return { status: "committed" };
}

async function commitSurcharge(
	database: CommitDb,
	row: typeof importStagedRow.$inferSelect,
	job: ImportCommitJobData,
) {
	const payload = row.normalizedPayload as unknown as SetupReferencePayload;
	const [created] = await database
		.insert(surchargeModel)
		.values({
			organizationId: job.organizationId,
			name: requiredName(payload, "surcharge"),
			description: payload.description?.trim() || payload.note?.trim() || null,
			isActive: isActiveValue(payload),
			createdBy: job.committedBy,
		})
		.returning({ id: surchargeModel.id });

	await markCommitted(database, row.id, job, "surcharge_model", created.id);
}

/** A reviewer's mapping change between routing and the claim restarts the row. */
class ImportRowScopeChangedError extends Error {
	constructor() {
		super("Import row scope changed while committing");
		this.name = "ImportRowScopeChangedError";
	}
}

const WORK_ROW_ATTEMPTS = 3;

type StagedRow = typeof importStagedRow.$inferSelect;

function routedEmployeeId(row: StagedRow): string {
	const employeeId = (row.normalizedPayload as Partial<WorkPeriodPayload>).employeeId;
	if (typeof employeeId !== "string" || employeeId.length === 0) {
		throw new Error("work_period import row requires a mapped employee before commit");
	}
	return employeeId;
}

async function getBatchProvider(job: ImportCommitJobData): Promise<ImportProvider> {
	const batch = await db.query.importBatch.findFirst({
		where: and(eq(importBatch.id, job.batchId), eq(importBatch.organizationId, job.organizationId)),
		columns: { provider: true },
	});
	if (!batch) throw new Error(`Import batch ${job.batchId} not found`);
	return batch.provider;
}

function importedWorkCommand(
	row: StagedRow,
	job: ImportCommitJobData,
	provider: ImportProvider,
): ImportedWorkCommand {
	const payload = row.normalizedPayload as Partial<WorkPeriodPayload>;
	return {
		version: 1,
		operationId: row.id,
		source: {
			provider,
			batchId: job.batchId,
			entityType: "work_period",
			providerSourceId: row.providerSourceId,
			sourcePayloadHash: row.sourcePayloadHash,
		},
		startsAt: String(payload.startsAt),
		endsAt: payload.endsAt ?? null,
		providerEvidence: importedWorkProviderEvidence(provider, row.sourcePayload),
	};
}

/**
 * Commits one reviewed work row inside the reviewed-import transaction (#284).
 * Routing reads the employee from the staged row; under protection the claimed
 * row must still route to it, otherwise the transaction rolls back and routing
 * restarts. Receipt replay runs first in every mode. Adopted organizations then
 * use the completed-work operation, which commits the whole graph or holds the
 * row with its evidence; the others keep the legacy writer.
 */
async function commitReviewedWorkRow(
	routedRow: StagedRow,
	job: ImportCommitJobData,
	provider: ImportProvider,
): Promise<CommitRowOutcome> {
	let row = routedRow;
	for (let attempt = 1; ; attempt++) {
		const employeeId = routedEmployeeId(row);
		const command = importedWorkCommand(row, job, provider);
		try {
			return await withReviewedImportTransaction(
				{
					organizationId: job.organizationId,
					employeeId,
					importerUserId: job.committedBy,
					sourceKey: importedWorkSourceKey(command.source),
				},
				async (scope): Promise<CommitRowOutcome> => {
					const database = scope.db as CommitDb;
					const claimed = await claimRow(database, row.id, job);
					if (!claimed) return { status: "skipped" };
					const claimedCommand = importedWorkCommand(claimed, job, provider);
					if (
						routedEmployeeId(claimed) !== employeeId ||
						importedWorkSourceKey(claimedCommand.source) !== importedWorkSourceKey(command.source)
					) {
						throw new ImportRowScopeChangedError();
					}
					const scoped = { organizationId: job.organizationId, employeeId };
					const outcome =
						(await replayImportedWork(scope, { ...scoped, command: claimedCommand })) ??
						(scope.admission === "append"
							? await recordImportedWork(scope, {
									...scoped,
									importerUserId: job.committedBy,
									command: claimedCommand,
									now: systemClock.nowInstant(),
								})
							: null);
					if (!outcome) {
						await commitWorkPeriod(database, claimed, job);
						return { status: "committed" };
					}
					if (outcome.kind === "held") return markHeld(database, claimed.id, job, outcome.hold);
					await markCommitted(
						database,
						claimed.id,
						job,
						"work_period",
						outcome.result.workPeriodId,
					);
					return { status: "committed" };
				},
			);
		} catch (error) {
			if (!(error instanceof ImportRowScopeChangedError) || attempt >= WORK_ROW_ATTEMPTS) {
				throw error;
			}
			const [rerouted] = await db
				.select()
				.from(importStagedRow)
				.where(
					and(
						eq(importStagedRow.id, row.id),
						eq(importStagedRow.batchId, job.batchId),
						eq(importStagedRow.organizationId, job.organizationId),
						eq(importStagedRow.entityType, job.entityType),
					),
				)
				.limit(1);
			if (rerouted?.rowStatus !== "accepted") return { status: "skipped" };
			row = rerouted;
		}
	}
}

/**
 * Setup entities whose rows manual preparation reads: organization holidays in
 * blocking categories and work categories (#318). Their commit takes exclusive
 * organization configuration protection before claiming the row, so it drains
 * and fences fresh manual submissions. Teams (created without members),
 * absences and surcharge models are not manual dependencies.
 */
const MANUAL_DEPENDENCY_SETUP_ENTITIES: ReadonlySet<ImportCommitJobData["entityType"]> = new Set([
	"holiday",
	"service",
	"work_category",
]);

function mappingRequiredMessage(entityType: ImportCommitJobData["entityType"]) {
	return `${entityType} import rows require mapping confirmation before commit`;
}

export async function commitAcceptedRowsForEntity(
	job: ImportCommitJobData,
	options: CommitOptions = {},
): Promise<CommitResult> {
	const finalAttempt = options.finalAttempt ?? true;
	const rows = await db
		.select()
		.from(importStagedRow)
		.where(
			and(
				eq(importStagedRow.batchId, job.batchId),
				eq(importStagedRow.organizationId, job.organizationId),
				eq(importStagedRow.entityType, job.entityType),
				eq(importStagedRow.rowStatus, "accepted"),
			),
		)
		// Deterministic staging order: the order rows append to an employee's history.
		.orderBy(asc(importStagedRow.createdAt), asc(importStagedRow.id));
	let committedRows = 0;
	let heldRows = 0;
	const errors: CommitRowError[] = [];
	const blockOptions = { finalAttempt };
	const provider =
		job.entityType === "work_period" && rows.length > 0 ? await getBatchProvider(job) : null;

	for (const row of rows) {
		if (row.rowStatus !== "accepted") continue;

		try {
			const outcome = provider
				? await commitReviewedWorkRow(row, job, provider)
				: await db.transaction(async (tx): Promise<CommitRowOutcome> => {
						if (MANUAL_DEPENDENCY_SETUP_ENTITIES.has(job.entityType)) {
							await acquireExclusiveOrganizationConfigurationGuard(tx, job.organizationId);
						}
						const claimedRow = await claimRow(tx as CommitDb, row.id, job);
						if (!claimedRow) return { status: "skipped" };

						switch (job.entityType) {
							case "absence":
								await commitAbsence(tx as CommitDb, claimedRow, job);
								return { status: "committed" };
							case "team":
								await commitTeam(tx as CommitDb, claimedRow, job);
								return { status: "committed" };
							case "service":
							case "work_category":
								await commitWorkCategory(tx as CommitDb, claimedRow, job);
								return { status: "committed" };
							case "holiday":
								return commitHoliday(tx as CommitDb, claimedRow, job, blockOptions);
							case "surcharge":
								await commitSurcharge(tx as CommitDb, claimedRow, job);
								return { status: "committed" };
							case "target_hours":
							case "work_policy":
							case "holiday_quota":
							case "employee":
							case "absence_category": {
								const message = mappingRequiredMessage(job.entityType);
								return blockRow(tx as CommitDb, claimedRow.id, job, message, blockOptions);
							}
							default:
								throw new Error(`Unsupported import review commit entity type: ${job.entityType}`);
						}
					});
			if (outcome.status === "skipped") continue;
			if (outcome.status === "held") {
				heldRows++;
				errors.push({ rowId: row.id, message: outcome.message });
				continue;
			}
			if (outcome.status === "blocked") {
				errors.push({ rowId: row.id, message: outcome.message });
				continue;
			}
			committedRows++;
		} catch (error) {
			const stillOwned = finalAttempt
				? await markCommitFailed(row.id, job, error)
				: (await getPersistedRowStatus(row.id, job)) === "accepted";
			if (!stillOwned) continue;
			errors.push({
				rowId: row.id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return {
		committedRows,
		failedRows: errors.length - heldRows,
		heldRows,
		errors,
		summary: await getCommitSummary(job),
	};
}
