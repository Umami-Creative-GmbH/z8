import { and, desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	importStagedRow,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import type { ImportCommitJobData } from "./types";

type CommitRowError = { rowId: string; message: string };
type CommitResult = { committedRows: number; failedRows: number; errors: CommitRowError[] };
type ChainHead = { id: string; hash: string } | null;
type CommitDb = Pick<typeof db, "insert" | "query" | "select" | "update">;

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

async function markCommitted(
	database: CommitDb,
	rowId: string,
	organizationId: string,
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
		.where(and(eq(importStagedRow.id, rowId), eq(importStagedRow.organizationId, organizationId)));
}

async function markCommitFailed(rowId: string, organizationId: string, error: unknown) {
	await db
		.update(importStagedRow)
		.set({
			rowStatus: "commit_failed",
			commitError: error instanceof Error ? error.message : String(error),
		})
		.where(and(eq(importStagedRow.id, rowId), eq(importStagedRow.organizationId, organizationId)));
}

async function assertEmployeeInOrganization(database: CommitDb, employeeId: string, organizationId: string) {
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
	chainHeads: Map<string, ChainHead>,
): Promise<ChainHead> {
	if (chainHeads.has(employeeId)) return chainHeads.get(employeeId) ?? null;

	const latest = await database.query.timeEntry.findFirst({
		where: and(
			eq(timeEntry.employeeId, employeeId),
			eq(timeEntry.organizationId, organizationId),
			eq(timeEntry.isSuperseded, false),
		),
		orderBy: [desc(timeEntry.createdAt)],
		columns: { id: true, hash: true },
	});
	const chainHead = latest ? { id: latest.id, hash: latest.hash } : null;
	chainHeads.set(employeeId, chainHead);
	return chainHead;
}

function parseUtcDateTime(value: string, fieldName: string): DateTime {
	const parsed = DateTime.fromISO(value, { zone: "utc" }).toUTC();
	if (!parsed.isValid) throw new Error(`Invalid ${fieldName}: ${value}`);
	return parsed;
}

async function commitWorkPeriod(
	database: CommitDb,
	row: typeof importStagedRow.$inferSelect,
	job: ImportCommitJobData,
	chainHeads: Map<string, ChainHead>,
): Promise<ChainHead> {
	const payload = row.normalizedPayload as unknown as WorkPeriodPayload;
	await assertEmployeeInOrganization(database, payload.employeeId, job.organizationId);

	const startAt = parseUtcDateTime(payload.startsAt, "startsAt");
	const endAt = payload.endsAt ? parseUtcDateTime(payload.endsAt, "endsAt") : null;
	const previous = await getChainHead(database, payload.employeeId, job.organizationId, chainHeads);
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
		})
		.returning({ id: timeEntry.id, hash: timeEntry.hash });

	let clockOutId: string | null = null;
	let latestEntry = { id: clockIn.id, hash: clockIn.hash };
	if (endAt) {
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

	await markCommitted(database, row.id, job.organizationId, "work_period", period.id);
	return latestEntry;
}

async function ensureAbsenceCategory(database: CommitDb, organizationId: string, categoryName: string) {
	const existing = await database.query.absenceCategory.findFirst({
		where: and(eq(absenceCategory.organizationId, organizationId), eq(absenceCategory.name, categoryName)),
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

async function commitAbsence(database: CommitDb, row: typeof importStagedRow.$inferSelect, job: ImportCommitJobData) {
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

	await markCommitted(database, row.id, job.organizationId, "absence_entry", absence.id);
}

export async function commitAcceptedRowsForEntity(job: ImportCommitJobData): Promise<CommitResult> {
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
	const chainHeads = new Map<string, ChainHead>();
	let committedRows = 0;
	const errors: CommitRowError[] = [];

	for (const row of rows) {
		if (row.rowStatus !== "accepted") continue;

		try {
			const latestChainHead = await db.transaction(async (tx) => {
				switch (job.entityType) {
					case "work_period":
						return commitWorkPeriod(tx as CommitDb, row, job, chainHeads);
					case "absence":
						await commitAbsence(tx as CommitDb, row, job);
						return null;
					default:
						throw new Error(`Unsupported import review commit entity type: ${job.entityType}`);
				}
			});
			if (job.entityType === "work_period") {
				const payload = row.normalizedPayload as unknown as WorkPeriodPayload;
				chainHeads.set(payload.employeeId, latestChainHead);
			}
			committedRows++;
		} catch (error) {
			await markCommitFailed(row.id, job.organizationId, error);
			errors.push({
				rowId: row.id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { committedRows, failedRows: errors.length, errors };
}
