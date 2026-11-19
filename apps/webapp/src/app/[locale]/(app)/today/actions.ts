"use server";

import { getManagerDailyBriefing } from "@/lib/manager-daily-briefing/get-manager-daily-briefing";
import { getCurrentEmployee } from "../team/actions";
import type { TodayArrival, TodayScope } from "./today-types";

/** Expected identity only fences arrivals; it grants no access or organization selection. */
export async function readTodayBriefing(expected: TodayScope): Promise<TodayArrival> {
	try {
		const employee = await getCurrentEmployee();
		if (
			!employee ||
			employee.userId !== expected.userId ||
			employee.organizationId !== expected.organizationId ||
			(employee.role !== "manager" && employee.role !== "admin")
		)
			return { status: "unavailable" };
		const view = {
			userId: employee.userId,
			organizationId: employee.organizationId,
			employeeId: employee.id,
			role: employee.role,
		};
		const briefing = await getManagerDailyBriefing({ currentEmployee: employee });
		return { status: "ready", briefing, view };
	} catch {
		return { status: "error" };
	}
}
