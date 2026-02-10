import type { Alignment, DriveStep, Side } from "driver.js";

export interface TourStepDef {
	element: string;
	titleKey: string;
	descriptionKey: string;
	roles?: ("admin" | "manager")[];
	side: Side;
	align: Alignment;
}

export const TOUR_STEP_DEFINITIONS: TourStepDef[] = [
	{
		element: '[data-tour="sidebar"]',
		titleKey: "tour.sidebar.title",
		descriptionKey: "tour.sidebar.description",
		side: "right",
		align: "start",
	},
	{
		element: '[data-tour="dashboard-widgets"]',
		titleKey: "tour.dashboard.title",
		descriptionKey: "tour.dashboard.description",
		side: "top",
		align: "center",
	},
	{
		element: '[data-tour="time-clock"]',
		titleKey: "tour.timeClock.title",
		descriptionKey: "tour.timeClock.description",
		side: "bottom",
		align: "end",
	},
	{
		element: '[data-tour="nav-time-tracking"]',
		titleKey: "tour.timeTracking.title",
		descriptionKey: "tour.timeTracking.description",
		side: "right",
		align: "center",
	},
	{
		element: '[data-tour="nav-calendar"]',
		titleKey: "tour.calendar.title",
		descriptionKey: "tour.calendar.description",
		side: "right",
		align: "center",
	},
	{
		element: '[data-tour="nav-absences"]',
		titleKey: "tour.absences.title",
		descriptionKey: "tour.absences.description",
		side: "right",
		align: "center",
	},
	{
		element: '[data-tour="request-absence"]',
		titleKey: "tour.requestAbsence.title",
		descriptionKey: "tour.requestAbsence.description",
		side: "bottom",
		align: "end",
	},
	{
		element: '[data-tour="nav-reports"]',
		titleKey: "tour.reports.title",
		descriptionKey: "tour.reports.description",
		side: "right",
		align: "center",
	},
	{
		element: '[data-tour="notification-bell"]',
		titleKey: "tour.notifications.title",
		descriptionKey: "tour.notifications.description",
		side: "bottom",
		align: "end",
	},
	{
		element: '[data-tour="nav-team-section"]',
		titleKey: "tour.teamSection.title",
		descriptionKey: "tour.teamSection.description",
		roles: ["admin", "manager"],
		side: "right",
		align: "center",
	},
	{
		element: '[data-tour="nav-approvals"]',
		titleKey: "tour.approvals.title",
		descriptionKey: "tour.approvals.description",
		roles: ["admin", "manager"],
		side: "right",
		align: "center",
	},
	{
		element: '[data-tour="nav-settings"]',
		titleKey: "tour.settings.title",
		descriptionKey: "tour.settings.description",
		roles: ["admin", "manager"],
		side: "right",
		align: "center",
	},
];

export function getStepsForRole(
	role: "admin" | "manager" | "employee" | null,
): TourStepDef[] {
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
				title: t(step.titleKey, step.titleKey),
				description: t(step.descriptionKey, step.descriptionKey),
				side: step.side,
				align: step.align,
			},
		}));
}
