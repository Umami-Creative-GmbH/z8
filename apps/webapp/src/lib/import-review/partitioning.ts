import { DateTime } from "luxon";
import type { ImportDateRange } from "./types";

export function partitionDateRangeByMonth(startDate: string, endDate: string): ImportDateRange[] {
	const partitions: ImportDateRange[] = [];
	let cursor = DateTime.fromISO(startDate).startOf("day");
	const final = DateTime.fromISO(endDate).startOf("day");
	while (cursor <= final) {
		const monthEnd = cursor.endOf("month").startOf("day");
		const partitionEnd = monthEnd < final ? monthEnd : final;
		partitions.push({ startDate: cursor.toISODate()!, endDate: partitionEnd.toISODate()! });
		cursor = partitionEnd.plus({ days: 1 });
	}
	return partitions;
}

export function chunkEmployeeIds(employeeIds: string[], chunkSize: number): string[][] {
	const chunks: string[][] = [];
	for (let index = 0; index < employeeIds.length; index += chunkSize) {
		chunks.push(employeeIds.slice(index, index + chunkSize));
	}
	return chunks;
}
