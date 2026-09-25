/**
 * Loads the organization-scoped evidence `assessHistoricalWork` needs, without
 * approval, end-present or date filters, in the same read-only repeatable-read
 * snapshot as append assurance (#319). The two claims stay separate: append
 * assurance never decides completeness, and completeness never decides lineage.
 *
 * The read covers the scoped employees' whole history plus one hop of linked
 * evidence owned by others (a period linking another employee's canonical record,
 * or the reverse), so ownership conflicts cannot hide behind an employee filter.
 */
import { and, eq, inArray, notInArray, type SQL } from "drizzle-orm";
import type { db as database } from "@/db";
import {
	completedWorkOperation,
	employee,
	timeEntry,
	timeEntryAppendControl,
	timeEntryAppendPosition,
	timeRecord,
	timeRecordAllocation,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { AppendAssuranceReport } from "./append-assurance";
import {
	type AppendEvidenceReader,
	readAppendAssurance,
	withAppendEvidenceSnapshot,
} from "./append-assurance-reader";
import {
	assessHistoricalWork,
	type ForeignOwnedWork,
	type HistoricalPeriodEvidence,
	type HistoricalRecordEvidence,
	type HistoricalWorkDiagnostics,
	type HistoricalWorkEvidence,
	type HistoricalWorkScope,
} from "./historical-work-diagnostics";

type Database = typeof database;

/** Keeps each `IN` list well under PostgreSQL's bind-parameter limit. */
const ID_CHUNK = 5_000;

async function selectInChunks<T>(
	ids: readonly string[],
	select: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
	const unique = [...new Set(ids)];
	const rows: T[] = [];
	// Sequential: the snapshot is one connection.
	for (let index = 0; index < unique.length; index += ID_CHUNK) {
		rows.push(...(await select(unique.slice(index, index + ID_CHUNK))));
	}
	return rows;
}

const periodColumns = {
	id: workPeriod.id,
	employeeId: workPeriod.employeeId,
	clockInId: workPeriod.clockInId,
	clockOutId: workPeriod.clockOutId,
	startTime: workPeriod.startTime,
	endTime: workPeriod.endTime,
	durationMinutes: workPeriod.durationMinutes,
	isActive: workPeriod.isActive,
	approvalStatus: workPeriod.approvalStatus,
	pendingChanges: workPeriod.pendingChanges,
	approvalWorkflowId: workPeriod.approvalWorkflowId,
	deletedAt: workPeriod.deletedAt,
	projectId: workPeriod.projectId,
	workCategoryId: workPeriod.workCategoryId,
	workLocationType: workPeriod.workLocationType,
	canonicalRecordId: workPeriod.canonicalRecordId,
	createdAt: workPeriod.createdAt,
};

const recordColumns = {
	id: timeRecord.id,
	employeeId: timeRecord.employeeId,
	startAt: timeRecord.startAt,
	endAt: timeRecord.endAt,
	durationMinutes: timeRecord.durationMinutes,
	approvalState: timeRecord.approvalState,
	origin: timeRecord.origin,
	createdAt: timeRecord.createdAt,
};

export async function readHistoricalWorkEvidence(
	reader: AppendEvidenceReader,
	organizationId: string,
	employeeIds: readonly string[],
): Promise<HistoricalWorkEvidence> {
	const periodRows = (where: SQL) =>
		reader
			.select(periodColumns)
			.from(workPeriod)
			.where(and(eq(workPeriod.organizationId, organizationId), where));
	const workRecordRows = (where: SQL) =>
		reader
			.select(recordColumns)
			.from(timeRecord)
			.where(
				and(
					eq(timeRecord.organizationId, organizationId),
					eq(timeRecord.recordKind, "work"),
					where,
				),
			);

	const periods = new Map<string, Awaited<ReturnType<typeof periodRows>>[number]>();
	const records = new Map<string, Awaited<ReturnType<typeof workRecordRows>>[number]>();
	for (const row of await selectInChunks(employeeIds, (chunk) =>
		periodRows(inArray(workPeriod.employeeId, chunk)),
	)) {
		periods.set(row.id, row);
	}
	for (const row of await selectInChunks(employeeIds, (chunk) =>
		workRecordRows(inArray(timeRecord.employeeId, chunk)),
	)) {
		records.set(row.id, row);
	}

	// One hop across ownership: records a loaded period links or shares an ID with,
	// and periods linking or sharing an ID with a loaded record.
	const linkedRecordIds = [...periods.values()].flatMap((period) =>
		[period.canonicalRecordId, period.id].filter((id): id is string => id !== null),
	);
	for (const row of await selectInChunks(
		linkedRecordIds.filter((id) => !records.has(id)),
		(chunk) => workRecordRows(inArray(timeRecord.id, chunk)),
	)) {
		records.set(row.id, row);
	}
	const recordIds = [...records.keys()];
	for (const row of await selectInChunks(recordIds, (chunk) =>
		periodRows(inArray(workPeriod.canonicalRecordId, chunk)),
	)) {
		periods.set(row.id, row);
	}
	for (const row of await selectInChunks(
		recordIds.filter((id) => !periods.has(id)),
		(chunk) => periodRows(inArray(workPeriod.id, chunk)),
	)) {
		periods.set(row.id, row);
	}

	const periodIds = [...periods.keys()];
	const endpointIds = [...periods.values()].flatMap((period) =>
		[period.clockInId, period.clockOutId].filter((id): id is string => id !== null),
	);
	const entries = await selectInChunks(endpointIds, (chunk) =>
		reader
			.select({
				id: timeEntry.id,
				employeeId: timeEntry.employeeId,
				type: timeEntry.type,
				timestamp: timeEntry.timestamp,
				utcOffsetMinutes: timeEntry.utcOffsetMinutes,
				timezone: timeEntry.timezone,
				timezoneSource: timeEntry.timezoneSource,
				isSuperseded: timeEntry.isSuperseded,
				supersededById: timeEntry.supersededById,
			})
			.from(timeEntry)
			.where(and(eq(timeEntry.organizationId, organizationId), inArray(timeEntry.id, chunk))),
	);
	const details = await selectInChunks(recordIds, (chunk) =>
		reader
			.select({
				recordId: timeRecordWork.recordId,
				workCategoryId: timeRecordWork.workCategoryId,
				workLocationType: timeRecordWork.workLocationType,
				computationMetadata: timeRecordWork.computationMetadata,
			})
			.from(timeRecordWork)
			.where(
				and(
					eq(timeRecordWork.organizationId, organizationId),
					inArray(timeRecordWork.recordId, chunk),
				),
			),
	);
	const allocations = await selectInChunks(recordIds, (chunk) =>
		reader
			.select({
				recordId: timeRecordAllocation.recordId,
				projectId: timeRecordAllocation.projectId,
			})
			.from(timeRecordAllocation)
			.where(
				and(
					eq(timeRecordAllocation.organizationId, organizationId),
					eq(timeRecordAllocation.allocationKind, "project"),
					inArray(timeRecordAllocation.recordId, chunk),
				),
			),
	);
	const operations = await selectInChunks(periodIds, (chunk) =>
		reader
			.select({
				id: completedWorkOperation.id,
				employeeId: completedWorkOperation.employeeId,
				kind: completedWorkOperation.kind,
				writer: completedWorkOperation.writer,
				writerVersion: completedWorkOperation.writerVersion,
				appendAdmission: completedWorkOperation.appendAdmission,
				workPeriodId: completedWorkOperation.workPeriodId,
				createdAt: completedWorkOperation.createdAt,
			})
			.from(completedWorkOperation)
			.where(
				and(
					eq(completedWorkOperation.organizationId, organizationId),
					inArray(completedWorkOperation.workPeriodId, chunk),
				),
			),
	);

	const ownerIds = [
		...new Set([
			...[...periods.values()].map((period) => period.employeeId),
			...[...records.values()].map((record) => record.employeeId),
		]),
	];
	const [control] = await reader
		.select({ mode: timeEntryAppendControl.mode, updatedAt: timeEntryAppendControl.updatedAt })
		.from(timeEntryAppendControl)
		.where(eq(timeEntryAppendControl.organizationId, organizationId));
	const admissions = await selectInChunks(ownerIds, (chunk) =>
		reader
			.select({
				employeeId: timeEntryAppendPosition.employeeId,
				admittedAt: timeEntryAppendPosition.admittedAt,
			})
			.from(timeEntryAppendPosition)
			.where(
				and(
					eq(timeEntryAppendPosition.organizationId, organizationId),
					inArray(timeEntryAppendPosition.employeeId, chunk),
				),
			),
	);

	const organizationEmployees = reader
		.select({ id: employee.id })
		.from(employee)
		.where(eq(employee.organizationId, organizationId));
	const foreignPeriods = await reader
		.select({ id: workPeriod.id })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				notInArray(workPeriod.employeeId, organizationEmployees),
			),
		);
	const foreignRecords = await reader
		.select({ id: timeRecord.id })
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.recordKind, "work"),
				notInArray(timeRecord.employeeId, organizationEmployees),
			),
		);

	const detailByRecord = new Map(details.map((detail) => [detail.recordId, detail]));
	const projectsByRecord = new Map<string, string[]>();
	for (const allocation of allocations) {
		if (allocation.projectId === null) continue;
		projectsByRecord.set(allocation.recordId, [
			...(projectsByRecord.get(allocation.recordId) ?? []),
			allocation.projectId,
		]);
	}

	return {
		organizationId,
		periods: [...periods.values()].map(
			(row): HistoricalPeriodEvidence => ({
				id: row.id,
				employeeId: row.employeeId,
				clockInId: row.clockInId,
				clockOutId: row.clockOutId,
				startTime: instantFromDate(row.startTime),
				endTime: row.endTime ? instantFromDate(row.endTime) : null,
				durationMinutes: row.durationMinutes,
				isActive: row.isActive,
				approvalStatus: row.approvalStatus,
				hasPendingChanges: row.pendingChanges !== null,
				approvalWorkflowId: row.approvalWorkflowId,
				deletedAt: row.deletedAt ? instantFromDate(row.deletedAt) : null,
				projectId: row.projectId,
				workCategoryId: row.workCategoryId,
				workLocationType: row.workLocationType,
				canonicalRecordId: row.canonicalRecordId,
				createdAt: instantFromDate(row.createdAt),
			}),
		),
		records: [...records.values()].map((row): HistoricalRecordEvidence => {
			const detail = detailByRecord.get(row.id);
			return {
				id: row.id,
				employeeId: row.employeeId,
				startAt: instantFromDate(row.startAt),
				endAt: row.endAt ? instantFromDate(row.endAt) : null,
				durationMinutes: row.durationMinutes,
				approvalState: row.approvalState,
				origin: row.origin,
				createdAt: instantFromDate(row.createdAt),
				detail: detail
					? {
							workCategoryId: detail.workCategoryId,
							workLocationType: detail.workLocationType,
							computationMetadata: detail.computationMetadata,
						}
					: null,
				projectIds: projectsByRecord.get(row.id) ?? [],
			};
		}),
		entries: entries.map((row) => ({
			...row,
			timestamp: instantFromDate(row.timestamp),
		})),
		operations: operations.map((row) => ({ ...row, createdAt: instantFromDate(row.createdAt) })),
		adoption: {
			control: control
				? { mode: control.mode, updatedAt: instantFromDate(control.updatedAt) }
				: null,
			admissions: new Map(
				admissions.map((row) => [row.employeeId, instantFromDate(row.admittedAt)]),
			),
		},
		foreignOwnedWork: [
			...foreignPeriods.map((row): ForeignOwnedWork => ({ kind: "work_period", id: row.id })),
			...foreignRecords.map((row): ForeignOwnedWork => ({ kind: "time_record", id: row.id })),
		],
	};
}

export interface HistoricalWorkRead {
	work: HistoricalWorkDiagnostics;
	/** Separate claim per scoped employee; never an input to completeness. */
	appendAssurance: Map<string, AppendAssuranceReport>;
}

/** Diagnoses the scope and assesses its employees' append assurance in one snapshot. */
export function readHistoricalWorkDiagnostics(
	db: Database,
	organizationId: string,
	scope: HistoricalWorkScope,
): Promise<HistoricalWorkRead> {
	return withAppendEvidenceSnapshot(db, async (reader) => {
		const evidence = await readHistoricalWorkEvidence(reader, organizationId, scope.employeeIds);
		const appendAssurance = await readAppendAssurance(reader, organizationId, scope.employeeIds);
		return { work: assessHistoricalWork(evidence, scope), appendAssurance };
	});
}
