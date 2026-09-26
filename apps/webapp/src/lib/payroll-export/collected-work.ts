import { parseISO } from "@/lib/datetime/luxon-utils";
import type { CollectedPayrollWorkInput } from "@/lib/payroll-collection/payroll-work-collection";
import type { WorkPeriodData } from "./types";

/**
 * Formatter lines from collected payroll work (#322). Each line is the credited part
 * of one work record, with its protected minutes; nothing is recomputed or reread.
 */
export function workPeriodsFromCollectedInput(input: CollectedPayrollWorkInput): WorkPeriodData[] {
	return input.work.map((line) => ({
		id: line.recordId,
		employeeId: line.employeeId,
		employeeNumber: line.person.employeeNumber || null,
		email: line.person.email || null,
		firstName: line.person.firstName || null,
		lastName: line.person.lastName || null,
		// The formatter contract is still Luxon-typed; convert only at this boundary.
		startTime: parseISO(line.startAt),
		endTime: parseISO(line.endExclusive),
		durationMinutes: line.minutes,
		workCategoryId: line.workCategory?.id ?? null,
		workCategoryName: line.workCategory?.name || null,
		workCategoryFactor: line.workCategory?.factor || null,
		projectId: line.project?.id ?? null,
		projectName: line.project?.name || null,
	}));
}
