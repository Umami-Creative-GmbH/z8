import { DateTime } from "luxon";
import type { ImportDateRange } from "./types";

export function partitionDateRangeByMonth(startDate: string, endDate: string): ImportDateRange[] {
	const partitions: ImportDateRange[] = [];
	let cursor: DateTime = DateTime.fromISO(startDate).startOf("day");
	const final: DateTime = DateTime.fromISO(endDate).startOf("day");
	if (!cursor.isValid) throw new Error(`Invalid import start date: ${startDate}`);
	if (!final.isValid) throw new Error(`Invalid import end date: ${endDate}`);
	if (cursor > final) throw new Error("Import start date must be on or before end date");
	while (cursor <= final) {
		const monthEnd = cursor.endOf("month").startOf("day");
		const partitionEnd = monthEnd < final ? monthEnd : final;
		partitions.push({ startDate: cursor.toISODate()!, endDate: partitionEnd.toISODate()! });
		cursor = partitionEnd.plus({ days: 1 });
	}
	return partitions;
}

export function chunkEmployeeIds(employeeIds: string[], chunkSize: number): string[][] {
	if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new RangeError("Employee chunk size must be a positive integer");
	const chunks: string[][] = [];
	for (let index = 0; index < employeeIds.length; index += chunkSize) {
		chunks.push(employeeIds.slice(index, index + chunkSize));
	}
	return chunks;
}
