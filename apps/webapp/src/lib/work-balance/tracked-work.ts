import { and, eq, gt, isNotNull, lt } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import { dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import {
	allocateProtectedMinutes,
	employeePayrollWindow,
} from "@/lib/payroll-allocation/protected-minutes";
import type { WorkBalanceDbClient } from "./db-client";

/** Use the payroll interval allocation rule; keep the original work and captures intact. */
export async function sumTrackedWorkMinutes(
	client: Pick<WorkBalanceDbClient, "select">,
	input: {
		organizationId: string;
		employeeId: string;
		startDate: string;
		throughDate: string;
		timezone: string;
	},
): Promise<number> {
	if (input.startDate > input.throughDate) return 0;
	const window = employeePayrollWindow(input.startDate, input.throughDate, input.timezone);
	const periods = await client
		.select({
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.durationMinutes),
				lt(workPeriod.startTime, dateFromInstant(window.endExclusive)),
				gt(workPeriod.endTime, dateFromInstant(window.start)),
			),
		);
	let total = 0;
	for (const period of periods) {
		if (!period.endTime) continue;
		const allocation = allocateProtectedMinutes(
			{
				startAt: instantFromDate(period.startTime),
				endAt: instantFromDate(period.endTime),
				storedMinutes: period.durationMinutes,
			},
			window,
		);
		if (allocation.status === "blocked")
			throw new Error(
				"Recorded work crossing the tracking boundary needs interval reconciliation.",
			);
		if (allocation.status === "allocated") total += allocation.minutes;
	}
	return total;
}
