import type { DashboardWidgetOrder } from "@/db/schema";
import type { CoverDuties } from "@/lib/absences/cover-duties";
import type { UpcomingShifts } from "@/lib/scheduling/upcoming-shifts";
import type {
	ManagedEmployeesResult,
	ManagerTodaySummaryResult,
	TeamOverviewStats,
	WhosOutToday,
} from "./actions";
import type { QuickStats } from "./quick-stats-tracking";

export type DashboardScope = {
	userId: string;
	organizationId: string;
};

export type DashboardLayoutSettings = {
	dashboardWidgetOrder: DashboardWidgetOrder | null;
};

export type DashboardLayoutBootstrap = {
	scope: DashboardScope;
	settings: DashboardLayoutSettings;
	updatedAt: number;
};

export type DashboardSubject = DashboardScope & {
	employee: {
		id: string;
		organizationId: string;
		role: "admin" | "manager" | "employee";
	} | null;
};

export type PendingApprovalsData = {
	absenceApprovals: {
		id: string;
		requester: { user: { name: string } };
		absence: { startDate: string; endDate: string; category: { name: string } };
	}[];
	timeCorrectionApprovals: {
		id: string;
		requester: { user: { name: string } };
		workPeriod: { startTime: string };
	}[];
};

export type RecentlyApprovedData = {
	id: string;
	type: "absence" | "time_correction";
	updatedAt: string;
	requestedByEmployee: { user: { name: string | null } };
	approverEmployee: { user: { name: string | null } } | null;
}[];

export type UpcomingTimeOffData = {
	id: string;
	startDate: string;
	endDate: string;
	absenceDays: number;
	daysUntil: number;
	employee: { id: string; user: { id: string; name: string | null; image: string | null } };
	category: { name: string; color: string | null };
}[];

export type DashboardWidgetData = {
	"upcoming-shifts": UpcomingShifts;
	"covering-for": CoverDuties & { viewerRole: "admin" | "manager" | "employee" };
	"whos-out-today": WhosOutToday;
	"upcoming-time-off": UpcomingTimeOffData;
	"managed-employees": ManagedEmployeesResult;
	"team-overview": TeamOverviewStats;
	"pending-approvals": PendingApprovalsData;
	"recently-approved": RecentlyApprovedData;
	"manager-today": ManagerTodaySummaryResult;
	"quick-stats": QuickStats;
};

export type ServerWidgetId = keyof DashboardWidgetData;

export type DashboardWidgetSnapshot<T> = {
	scope: DashboardScope;
	result: { success: true; data: T | null } | { success: false; error: string };
	updatedAt: number;
};

export const SERVER_WIDGET_IDS: readonly ServerWidgetId[] = [
	"upcoming-shifts",
	"covering-for",
	"whos-out-today",
	"upcoming-time-off",
	"managed-employees",
	"team-overview",
	"pending-approvals",
	"recently-approved",
	"manager-today",
	"quick-stats",
];

export function isServerWidgetId(id: string): id is ServerWidgetId {
	return SERVER_WIDGET_IDS.some((candidate) => candidate === id);
}
