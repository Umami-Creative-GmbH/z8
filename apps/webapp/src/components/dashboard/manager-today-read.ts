import "server-only";

import { getManagerDailyBriefing } from "@/lib/manager-daily-briefing/get-manager-daily-briefing";
import type { ManagerTodaySummaryResult } from "./actions";
import type { DashboardSubject } from "./dashboard-types";

/** A render or freshly authorized request owns this subject; it is never client authorization. */
export async function loadManagerTodayForEmployee(
	employee: DashboardSubject["employee"],
): Promise<ManagerTodaySummaryResult> {
	if (!employee || (employee.role !== "admin" && employee.role !== "manager")) {
		return { role: employee?.role ?? null, summary: null };
	}
	try {
		const briefing = await getManagerDailyBriefing({
			currentEmployee: employee,
		});
		return { role: employee.role, summary: briefing.summary };
	} catch {
		return {
			role: employee.role,
			summary: null,
			error: "Manager Today counts could not be loaded.",
		};
	}
}
