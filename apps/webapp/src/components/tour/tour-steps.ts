import type { Alignment, DriveStep, Side } from "driver.js";

export interface TourStepDef {
	element: string;
	titleKey: string;
	titleDefault: string;
	descriptionKey: string;
	descriptionDefault: string;
	roles?: ("admin" | "manager")[];
	side: Side;
	align: Alignment;
}

export const TOUR_STEP_DEFINITIONS: TourStepDef[] = [
	{
		element: '[data-tour="sidebar"]',
		titleKey: "tour.sidebar.title",
		titleDefault: "Navigate Z8",
		descriptionKey: "tour.sidebar.description",
		descriptionDefault:
			"Use the sidebar to move between time tracking, planning, reports, and settings.",
		side: "right",
		align: "start",
	},
	{
		element: '[data-tour="dashboard-widgets"]',
		titleKey: "tour.dashboard.title",
		titleDefault: "Start from the dashboard",
		descriptionKey: "tour.dashboard.description",
		descriptionDefault: "Track your current day, important summaries, and pending items from here.",
		side: "top",
		align: "center",
	},
	{
		element: '[data-tour="time-clock"]',
		titleKey: "tour.timeClock.title",
		titleDefault: "Record your time",
		descriptionKey: "tour.timeClock.description",
		descriptionDefault: "Clock in and out quickly and keep your workday recorded accurately.",
		side: "bottom",
		align: "end",
	},
	{
		element: '[data-tour="nav-time-tracking"]',
		titleKey: "tour.timeTracking.title",
		titleDefault: "Track work entries",
		descriptionKey: "tour.timeTracking.description",
		descriptionDefault: "Review and adjust time entries before they are approved or exported.",
		side: "right",
		align: "center",
	},
	{
		element: '[data-tour="nav-calendar"]',
		titleKey: "tour.calendar.title",
		titleDefault: "Check the calendar",
		descriptionKey: "tour.calendar.description",
		descriptionDefault: "Use the calendar to see schedules, absences, and team availability.",
		side: "right",
		align: "center",
	},
	{
		element: '[data-tour="nav-absences"]',
		titleKey: "tour.absences.title",
		titleDefault: "Manage absences",
		descriptionKey: "tour.absences.description",
		descriptionDefault: "Review absence balances, requests, and approvals in one place.",
		side: "right",
		align: "center",
	},
	{
		element: '[data-tour="request-absence"]',
		titleKey: "tour.requestAbsence.title",
		titleDefault: "Request time off",
		descriptionKey: "tour.requestAbsence.description",
		descriptionDefault: "Submit vacation, sick leave, or other absence requests from here.",
		side: "bottom",
		align: "end",
	},
	{
		element: '[data-tour="nav-reports"]',
		titleKey: "tour.reports.title",
		titleDefault: "Use reports",
		descriptionKey: "tour.reports.description",
		descriptionDefault:
			"Create reports and exports for payroll, compliance, and operational reviews.",
		side: "right",
		align: "center",
	},
	{
		element: '[data-tour="notification-bell"]',
		titleKey: "tour.notifications.title",
		titleDefault: "Stay informed",
		descriptionKey: "tour.notifications.description",
		descriptionDefault: "Open notifications to catch approvals, updates, and important reminders.",
		side: "bottom",
		align: "end",
	},
	{
		element: '[data-tour="nav-team-section"]',
		titleKey: "tour.teamSection.title",
		titleDefault: "Work with your team",
		descriptionKey: "tour.teamSection.description",
		descriptionDefault:
			"Team tools help managers coordinate approvals, schedules, and employee records.",
		roles: ["admin", "manager"],
		side: "right",
		align: "center",
	},
	{
		element: '[data-tour="nav-approvals"]',
		titleKey: "tour.approvals.title",
		titleDefault: "Handle approvals",
		descriptionKey: "tour.approvals.description",
		descriptionDefault: "Review pending time entries and absence requests from your team.",
		roles: ["admin", "manager"],
		side: "right",
		align: "center",
	},
	{
		element: '[data-tour="nav-settings"]',
		titleKey: "tour.settings.title",
		titleDefault: "Configure settings",
		descriptionKey: "tour.settings.description",
		descriptionDefault:
			"Configure organization rules, teams, employees, and time tracking policies.",
		roles: ["admin", "manager"],
		side: "right",
		align: "center",
	},
];

export function getStepsForRole(role: "admin" | "manager" | "employee" | null): TourStepDef[] {
	return TOUR_STEP_DEFINITIONS.filter((step) => {
		if (!step.roles) return true;
		if (!role) return false;
		return step.roles.includes(role as "admin" | "manager");
	});
}

export function buildDriverSteps(
	steps: TourStepDef[],
	t: (key: string, defaultValue: string) => string,
): DriveStep[] {
	return steps
		.filter((step) => document.querySelector(step.element))
		.map((step) => ({
			element: step.element,
			popover: {
				title: t(step.titleKey, step.titleDefault),
				description: t(step.descriptionKey, step.descriptionDefault),
				side: step.side,
				align: step.align,
			},
		}));
}
