import {
	IconBeach,
	IconCalendar,
	IconCalendarCheck,
	IconCalendarEvent,
	IconCalendarTime,
	IconCash,
	IconClipboardCheck,
	IconClock,
	IconDashboard,
	IconFileDescription,
	IconFolder,
	IconFolders,
	IconGavel,
	IconHelp,
	IconHierarchy,
	IconMessageCircle,
	IconReceipt,
	IconReport,
	IconReportMoney,
	IconServerCog,
	IconSettings,
	IconShieldCheck,
	IconUserCheck,
	IconUsers,
} from "@tabler/icons-react";
import { FinanceNavBadge } from "@/components/travel-expenses/finance/finance-nav-badge";

export interface NavigationCapabilities {
	scheduling: boolean;
	compliance: boolean;
	payroll: boolean;
	/** Owners, admins and active expense officers (#753). */
	finance: boolean;
	worksCouncil: boolean;
	/** The employee's own shared documents while personnel files are on (#865). */
	myDocuments?: boolean;
	/** Owners, admins and active personnel file officers while personnel files are on (#866). */
	personnelFiles?: boolean;
	/** Managers and above while the organization collects period submissions (#1075). */
	periodSubmissions?: boolean;
	/** Who Is In is useful only while the active organization has active locations. */
	teamPresence?: boolean;
	platformAdmin: boolean;
}

export type SidebarEmployeeRole = "admin" | "manager" | "employee" | null;

type Translate = (key: string, defaultValue: string) => string;

// Personal section - visible to ALL users
export function buildPersonalNav(
	t: Translate,
	navigationCapabilities: NavigationCapabilities,
	employeeRole: SidebarEmployeeRole,
) {
	return [
		{
			title: t("nav.dashboard", "Dashboard"),
			url: "/",
			icon: IconDashboard,
		},
		{
			title: t("nav.time-tracking", "Time Tracking"),
			url: "/time-tracking",
			icon: IconClock,
		},
		{
			title: t("nav.calendar", "Calendar"),
			url: "/calendar",
			icon: IconCalendarEvent,
		},
		// Employees reach their own shifts here; planners keep Scheduling in the Team section.
		...(navigationCapabilities.scheduling && employeeRole === "employee"
			? [
					{
						title: t("nav.my-schedule", "My Schedule"),
						url: "/scheduling",
						icon: IconCalendarTime,
					},
				]
			: []),
		{
			title: t("nav.absences", "Absences"),
			url: "/absences",
			icon: IconBeach,
		},
		{
			title: t("nav.travel-expenses", "Travel Expenses"),
			url: "/travel-expenses",
			icon: IconReceipt,
		},
		...(navigationCapabilities.finance
			? [
					{
						title: t("nav.finance", "Finance"),
						url: "/travel-expenses/finance",
						icon: IconReportMoney,
						badge: <FinanceNavBadge />,
					},
				]
			: []),
		{
			title: t("nav.my-requests", "My Requests"),
			url: "/my-requests",
			icon: IconFileDescription,
		},
		...(navigationCapabilities.myDocuments
			? [
					{
						title: t("nav.my-documents", "My Documents"),
						url: "/my-documents",
						icon: IconFolder,
					},
				]
			: []),
		...(navigationCapabilities.personnelFiles
			? [
					{
						title: t("nav.personnel-files", "Personnel Files"),
						url: "/personnel-files",
						icon: IconFolders,
					},
				]
			: []),
		{
			title: t("nav.reports", "Reports"),
			url: "/reports",
			icon: IconReport,
		},
		{
			title: t("nav.org-explorer", "Org Explorer"),
			url: "/organization",
			icon: IconHierarchy,
		},
		...(navigationCapabilities.payroll
			? [
					{
						title: t("nav.payroll", "Payroll"),
						url: "/payroll",
						icon: IconCash,
					},
				]
			: []),
	];
}

// Team section - admin/manager only
export function buildTeamNav(
	t: Translate,
	navigationCapabilities: NavigationCapabilities,
) {
	return [
		{
			title: t("nav.team", "Team"),
			url: "/team",
			icon: IconUsers,
		},
		{
			title: t("nav.teamAbsences", "Team Absences"),
			url: "/team/absences",
			icon: IconBeach,
		},
		...(navigationCapabilities.teamPresence
			? [
					{
						title: t("nav.teamPresence", "Who Is In"),
						url: "/team/presence",
						icon: IconUserCheck,
					},
				]
			: []),
		// Only while the organization collects period submissions (current or scheduled cadence)
		...(navigationCapabilities.periodSubmissions
			? [
					{
						title: t("nav.teamPeriodSubmissions", "Period Submissions"),
						url: "/team/period-submissions",
						icon: IconCalendarCheck,
					},
				]
			: []),
		// Only show Scheduling when shifts are enabled for the organization
		...(navigationCapabilities.scheduling
			? [
					{
						title: t("nav.scheduling", "Scheduling"),
						url: "/scheduling",
						icon: IconCalendar,
					},
				]
			: []),
		{
			title: t("nav.approvals", "Approvals"),
			url: "/approvals/inbox",
			icon: IconClipboardCheck,
		},
	];
}

export function buildSecondaryNav(
	t: Translate,
	navigationCapabilities: NavigationCapabilities,
) {
	return [
		...(navigationCapabilities.compliance
			? [
					{
						title: t("nav.compliance", "Compliance"),
						url: "/compliance",
						icon: IconShieldCheck,
					},
				]
			: []),
		...(navigationCapabilities.worksCouncil
			? [
					{
						title: t("nav.worksCouncil", "Works Council"),
						url: "/works-council",
						icon: IconGavel,
					},
				]
			: []),
		{
			title: t("nav.settings", "Settings"),
			url: "/settings",
			icon: IconSettings,
		},
		{
			title: t("nav.get-help", "Get Help"),
			url: "https://docs.z8-time.app/docs",
			icon: IconHelp,
			external: true,
		},
		{
			title: t("nav.feedback", "Feedback"),
			url: "https://github.com/Umami-Creative-GmbH/z8/issues",
			icon: IconMessageCircle,
			external: true,
		},
		...(navigationCapabilities.platformAdmin
			? [
					{
						title: t("nav.platform-admin", "Platform Admin"),
						url: "/platform-admin",
						icon: IconServerCog,
					},
				]
			: []),
	];
}

interface SessionUserLike {
	id?: string | null;
	name?: string | null;
	email?: string | null;
	image?: string | null;
}

/** Maps the signed-in session user onto the footer's NavUser shape. */
export function toNavUser(user: SessionUserLike | null | undefined) {
	return {
		id: user?.id || "",
		name: user?.name || "",
		email: user?.email || "",
		avatar: user?.image ?? undefined,
	};
}
