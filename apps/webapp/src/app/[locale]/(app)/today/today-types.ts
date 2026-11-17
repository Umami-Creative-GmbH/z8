import type { ManagerDailyBriefing } from "@/lib/manager-daily-briefing/types";

export type TodayScope = { userId: string; organizationId: string };
export type TodayView = TodayScope & { employeeId: string; role: string };
export type TodayArrival =
	| { status: "ready"; briefing: ManagerDailyBriefing; view: TodayView }
	| { status: "unavailable" }
	| { status: "error" };
