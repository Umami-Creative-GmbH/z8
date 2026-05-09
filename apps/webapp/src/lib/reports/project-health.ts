import { DateTime } from "luxon";

import type { ProjectHealthFields, ProjectSummary, ProjectBudgetHealthTotals } from "./project-types";

interface BuildProjectHealthFieldsParams {
	projectName: string;
	rangeHours: number;
	cumulativeHours: number;
	budgetHours: number | null;
	deadline: Date | null;
	now: Date;
	rangeStart: Date;
	rangeEnd: Date;
}

export function buildProjectHealthFields({
	projectName,
	rangeHours,
	cumulativeHours,
	budgetHours,
	deadline,
	now,
	rangeStart,
	rangeEnd,
}: BuildProjectHealthFieldsParams): ProjectHealthFields {
	const percentBudgetUsed = budgetHours && budgetHours > 0 ? (cumulativeHours / budgetHours) * 100 : null;
	const budgetFields = buildBudgetFields(percentBudgetUsed);
	const deadlineFields = buildDeadlineFields(deadline, now);
	const forecastFields = buildForecastFields({ projectName, rangeHours, cumulativeHours, budgetHours, deadline, now, rangeStart, rangeEnd });

	return {
		...budgetFields,
		...deadlineFields,
		...forecastFields,
	};
}

export function buildProjectHealthTotals(projects: ProjectSummary[]): ProjectBudgetHealthTotals {
	return projects.reduce<ProjectBudgetHealthTotals>(
		(totals, project) => {
			const percentBudgetUsed = project.percentBudgetUsed ?? 0;

			if (percentBudgetUsed >= 70) {
				totals.projectsAtOrAbove70Budget += 1;
			}

			if (percentBudgetUsed >= 90) {
				totals.projectsAtOrAbove90Budget += 1;
			}

			if (percentBudgetUsed >= 100) {
				totals.projectsOverBudget += 1;
			}

			if (project.forecastSeverity !== "none") {
				totals.projectsForecastAtRisk += 1;
			}

			return totals;
		},
		{
			projectsAtOrAbove70Budget: 0,
			projectsAtOrAbove90Budget: 0,
			projectsOverBudget: 0,
			projectsForecastAtRisk: 0,
		},
	);
}

export function sortProjectHealthAlerts(projects: ProjectSummary[]): ProjectSummary[] {
	return projects
		.filter(hasProjectHealthAlert)
		.toSorted((left, right) => {
			const severityDiff = severityRank(right) - severityRank(left);

			if (severityDiff !== 0) {
				return severityDiff;
			}

			const deadlineDiff = riskDateTime(left) - riskDateTime(right);

			if (deadlineDiff !== 0 && !Number.isNaN(deadlineDiff)) {
				return deadlineDiff;
			}

			return (right.percentBudgetUsed ?? 0) - (left.percentBudgetUsed ?? 0);
		});
}

export function hasProjectHealthAlert(project: ProjectSummary): boolean {
	return project.budgetSeverity !== "none" || project.deadlineSeverity !== "none" || project.forecastSeverity !== "none";
}

function buildBudgetFields(percentBudgetUsed: number | null): Pick<ProjectHealthFields, "budgetSeverity" | "budgetAlertType"> {
	if (percentBudgetUsed === null || percentBudgetUsed < 70) {
		return { budgetSeverity: "none", budgetAlertType: null };
	}

	if (percentBudgetUsed >= 100) {
		return { budgetSeverity: "critical", budgetAlertType: "budget_100" };
	}

	if (percentBudgetUsed >= 90) {
		return { budgetSeverity: "warning", budgetAlertType: "budget_90" };
	}

	return { budgetSeverity: "warning", budgetAlertType: "budget_70" };
}

function buildDeadlineFields(deadline: Date | null, now: Date): Pick<ProjectHealthFields, "deadlineSeverity" | "deadlineAlertType"> {
	if (!deadline) {
		return { deadlineSeverity: "none", deadlineAlertType: null };
	}

	const nowDay = DateTime.fromJSDate(now).toUTC().startOf("day");
	const deadlineDay = DateTime.fromJSDate(deadline).toUTC().startOf("day");
	const daysUntilDeadline = Math.floor(deadlineDay.diff(nowDay, "days").days);

	if (daysUntilDeadline < 0) {
		return { deadlineSeverity: "critical", deadlineAlertType: "deadline_overdue" };
	}

	if (daysUntilDeadline === 0) {
		return { deadlineSeverity: "critical", deadlineAlertType: "deadline_today" };
	}

	if (daysUntilDeadline <= 1) {
		return { deadlineSeverity: "critical", deadlineAlertType: "deadline_1d" };
	}

	if (daysUntilDeadline <= 7) {
		return { deadlineSeverity: "warning", deadlineAlertType: "deadline_7d" };
	}

	if (daysUntilDeadline <= 14) {
		return { deadlineSeverity: "warning", deadlineAlertType: "deadline_14d" };
	}

	return { deadlineSeverity: "none", deadlineAlertType: null };
}

function buildForecastFields({
	projectName,
	rangeHours,
	cumulativeHours,
	budgetHours,
	deadline,
	now,
	rangeStart,
	rangeEnd,
}: BuildProjectHealthFieldsParams): Pick<
	ProjectHealthFields,
	"forecastSeverity" | "forecastBudgetExhaustionDate" | "forecastMessage"
> {
	if (!budgetHours || !deadline || rangeHours <= 0 || cumulativeHours >= budgetHours) {
		return { forecastSeverity: "none", forecastBudgetExhaustionDate: null, forecastMessage: null };
	}

	const rangeDays = Math.max(1, DateTime.fromJSDate(rangeEnd).diff(DateTime.fromJSDate(rangeStart), "days").days);
	const averageDailyHours = rangeHours / rangeDays;
	const remainingBudgetHours = budgetHours - cumulativeHours;
	const daysUntilExhaustion = remainingBudgetHours / averageDailyHours;
	const forecastBudgetExhaustionDate = DateTime.fromJSDate(now).plus({ days: daysUntilExhaustion }).toJSDate();

	if (forecastBudgetExhaustionDate >= deadline) {
		return { forecastSeverity: "none", forecastBudgetExhaustionDate: null, forecastMessage: null };
	}

	const deadlineBufferDays = DateTime.fromJSDate(deadline).diff(DateTime.fromJSDate(forecastBudgetExhaustionDate), "days").days;

	return {
		forecastSeverity: deadlineBufferDays <= 3 ? "critical" : "warning",
		forecastBudgetExhaustionDate,
		forecastMessage: `${projectName} budget may be exhausted before its deadline at the current burn rate.`,
	};
}

function severityRank(project: ProjectSummary): number {
	if ([project.budgetSeverity, project.deadlineSeverity, project.forecastSeverity].includes("critical")) {
		return 2;
	}

	if ([project.budgetSeverity, project.deadlineSeverity, project.forecastSeverity].includes("warning")) {
		return 1;
	}

	return 0;
}

function riskDateTime(project: ProjectSummary): number {
	const riskDates = [
		project.deadlineSeverity !== "none" ? project.deadline : null,
		project.forecastSeverity !== "none" ? project.forecastBudgetExhaustionDate : null,
	]
		.filter((date): date is Date => date !== null)
		.map((date) => date.getTime());

	return riskDates.length > 0 ? Math.min(...riskDates) : Number.POSITIVE_INFINITY;
}
