/**
 * Reads the organization/employee-scoped evidence append assurance needs: every
 * retained entry (inactive ones included), the append position and whether
 * scoped work exists. One read-only repeatable-read snapshot keeps a concurrent
 * append from appearing as a spurious interruption.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { db as database } from "@/db";
import { timeEntry, timeEntryAppendPosition, workPeriod } from "@/db/schema";
import { type AppendAssuranceReport, assessAppendAssurance } from "./append-assurance";
import type { AppendEvidenceEntry } from "./append-lineage";

type Database = typeof database;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type AppendEvidenceReader = Pick<Transaction, "select" | "selectDistinct">;

/** Runs `read` in a read-only repeatable-read snapshot. */
export function withAppendEvidenceSnapshot<T>(
	db: Database,
	read: (reader: AppendEvidenceReader) => Promise<T>,
): Promise<T> {
	return db.transaction(read, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Assesses each listed employee of one organization; employees are never mixed. */
export async function readAppendAssurance(
	reader: AppendEvidenceReader,
	organizationId: string,
	employeeIds: readonly string[],
): Promise<Map<string, AppendAssuranceReport>> {
	const reports = new Map<string, AppendAssuranceReport>();
	const uniqueEmployeeIds = [...new Set(employeeIds)].toSorted();
	if (uniqueEmployeeIds.length === 0) return reports;

	// Sequential: the snapshot is one connection.
	const entries = await reader
		.select({
			id: timeEntry.id,
			organizationId: timeEntry.organizationId,
			employeeId: timeEntry.employeeId,
			type: timeEntry.type,
			timestamp: timeEntry.timestamp,
			hash: timeEntry.hash,
			previousHash: timeEntry.previousHash,
			previousEntryId: timeEntry.previousEntryId,
		})
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, organizationId),
				inArray(timeEntry.employeeId, uniqueEmployeeIds),
			),
		);
	const positions = await reader
		.select()
		.from(timeEntryAppendPosition)
		.where(
			and(
				eq(timeEntryAppendPosition.organizationId, organizationId),
				inArray(timeEntryAppendPosition.employeeId, uniqueEmployeeIds),
			),
		);
	const workRows = await reader
		.selectDistinct({ employeeId: workPeriod.employeeId })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				inArray(workPeriod.employeeId, uniqueEmployeeIds),
			),
		);

	const entriesByEmployee = new Map<string, AppendEvidenceEntry[]>();
	for (const entry of entries) {
		entriesByEmployee.set(entry.employeeId, [
			...(entriesByEmployee.get(entry.employeeId) ?? []),
			entry,
		]);
	}
	const positionByEmployee = new Map(positions.map((row) => [row.employeeId, row]));
	const employeesWithWork = new Set(workRows.map((row) => row.employeeId));

	for (const employeeId of uniqueEmployeeIds) {
		const position = positionByEmployee.get(employeeId);
		reports.set(
			employeeId,
			assessAppendAssurance({
				scope: { organizationId, employeeId },
				entries: entriesByEmployee.get(employeeId) ?? [],
				position: position
					? {
							tipEntryId: position.tipEntryId,
							tipHash: position.tipHash,
							entryCount: position.entryCount,
							admission: position.admission,
							admittedTipEntryId: position.admittedTipEntryId,
							admittedTipHash: position.admittedTipHash,
							admittedEntryCount: position.admittedEntryCount,
							admittedAt: position.admittedAt,
						}
					: null,
				hasWork: employeesWithWork.has(employeeId),
			}),
		);
	}
	return reports;
}

export async function readEmployeeAppendAssurance(
	db: Database,
	scope: { organizationId: string; employeeId: string },
): Promise<AppendAssuranceReport> {
	const reports = await withAppendEvidenceSnapshot(db, (reader) =>
		readAppendAssurance(reader, scope.organizationId, [scope.employeeId]),
	);
	const report = reports.get(scope.employeeId);
	if (!report) throw new Error("Append assurance was not assessed for the employee");
	return report;
}
