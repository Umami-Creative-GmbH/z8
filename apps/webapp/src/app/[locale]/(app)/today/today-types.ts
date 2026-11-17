import type { ManagerDailyBriefing } from "@/lib/manager-daily-briefing/types";

export type TodayScope = { userId: string; organizationId: string };
export type TodayArrival =
	| { status: "ready"; briefing: ManagerDailyBriefing }
	| { status: "unavailable" }
	| { status: "error" };
