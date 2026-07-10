import { and, eq, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	holiday,
	holidayCategory,
	importStagedRow,
	surchargeModel,
	team,
	timeEntry,
	workCategory,
	workPeriod,
} from "@/db/schema";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import { resolveFallbackTimezoneCapture } from "@/lib/time-tracking/timezone-capture";
import type { ImportCommitJobData } from "./types";

type CommitRowError = { rowId: string; message: string };
type CommitSummary = {
	remainingRows: number;
	totalCommittedRows: number;
	terminalFailedRows: number;
};
type CommitResult = {
	committedRows: number;
	failedRows: number;
	errors: CommitRowError[];
	summary: CommitSummary;
};
type CommitOptions = { finalAttempt?: boolean };
type ChainHead = { id: string; hash: string } | null;
type CommitDb = Pick<typeof db, "execute" | "insert" | "query" | "select" | "update">;
type CommitRowOutcome =
	| { status: "committed" }
	| { status: "blocked"; message: string }
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

async function commitWorkPeriod(
	database: CommitDb,
	row: typeof importStagedRow.$inferSelect,
	job: ImportCommitJobData,
) {
	const payload = row.normalizedPayload as unknown as WorkPeriodPayload;
	await assertEmployeeInOrganization(database, payload.employeeId, job.organizationId);
	const lockKey = `${job.organizationId}:${payload.employeeId}`;
	await database.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

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
		);
	let committedRows = 0;
	const errors: CommitRowError[] = [];
	const blockOptions = { finalAttempt };

	for (const row of rows) {
		if (row.rowStatus !== "accepted") continue;

		try {
			const outcome = await db.transaction(async (tx): Promise<CommitRowOutcome> => {
				const claimedRow = await claimRow(tx as CommitDb, row.id, job);
				if (!claimedRow) return { status: "skipped" };

				switch (job.entityType) {
					case "work_period":
						await commitWorkPeriod(tx as CommitDb, claimedRow, job);
						return { status: "committed" };
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
		failedRows: errors.length,
		errors,
		summary: await getCommitSummary(job),
	};
}
