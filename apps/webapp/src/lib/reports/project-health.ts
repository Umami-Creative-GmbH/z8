import { dateFromInstant, type Instant, type PlainDate } from "@/lib/datetime/temporal-core";
import { daysUntilProjectDeadline, projectDeadlineDay } from "@/lib/projects/project-deadline-days";
import type { ReportDayRange } from "./project-report-work";
import type {
	ProjectBudgetHealthTotals,
	ProjectHealthFields,
	ProjectSummary,
} from "./project-types";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

interface BuildProjectHealthFieldsParams {
	projectName: string;
	rangeHours: number;
	cumulativeHours: number;
	budgetHours: number | null;
	/** The deadline day, stored as its UTC midnight (the project form's representation). */
	deadline: Date | null;
	now: Instant;
	/** The organization's timezone, which decides today's date. */
	timeZone: string;
	/** The report's calendar days, both inclusive. */
	range: ReportDayRange;
}

/**
 * A project's budget, deadline and forecast health. Today is the calendar date
 * in the organization's timezone, never the server's or the viewer's.
 */
export function buildProjectHealthFields(
	params: BuildProjectHealthFieldsParams,
): ProjectHealthFields {
	const { budgetHours, cumulativeHours, deadline, now, timeZone } = params;
	const percentBudgetUsed =
		budgetHours && budgetHours > 0 ? (cumulativeHours / budgetHours) * 100 : null;
	const deadlineDay = deadline ? projectDeadlineDay(deadline) : null;
	const daysUntilDeadline = deadline
		? daysUntilProjectDeadline({ deadline, now, timeZone })
		: null;

	return {
		...buildBudgetFields(percentBudgetUsed),
		...buildDeadlineFields(daysUntilDeadline),
		...buildForecastFields(params, deadlineDay),
		daysUntilDeadline,
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
	return projects.filter(hasProjectHealthAlert).toSorted((left, right) => {
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
	return (
		project.budgetSeverity !== "none" ||
		project.deadlineSeverity !== "none" ||
		project.forecastSeverity !== "none"
	);
}

function buildBudgetFields(
	percentBudgetUsed: number | null,
): Pick<ProjectHealthFields, "budgetSeverity" | "budgetAlertType"> {
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

function buildDeadlineFields(
	daysUntilDeadline: number | null,
): Pick<ProjectHealthFields, "deadlineSeverity" | "deadlineAlertType"> {
	if (daysUntilDeadline === null) {
		return { deadlineSeverity: "none", deadlineAlertType: null };
	}

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

/**
 * When the remaining budget runs out at the range's burn rate (its hours spread
 * over every report day), if that is before the deadline day starts in the
 * organization's timezone.
 */
function buildForecastFields(
	{
		projectName,
		rangeHours,
		cumulativeHours,
		budgetHours,
		now,
		timeZone,
		range,
	}: BuildProjectHealthFieldsParams,
	deadlineDay: PlainDate | null,
): Pick<
	ProjectHealthFields,
	"forecastSeverity" | "forecastBudgetExhaustionDate" | "forecastMessage"
> {
	if (!budgetHours || !deadlineDay || rangeHours <= 0 || cumulativeHours >= budgetHours) {
		return { forecastSeverity: "none", forecastBudgetExhaustionDate: null, forecastMessage: null };
	}

	const rangeDays = range.fromDay.until(range.toDay, { largestUnit: "days" }).days + 1;
	const averageDailyHours = rangeHours / Math.max(1, rangeDays);
	const remainingBudgetHours = budgetHours - cumulativeHours;
	const daysUntilExhaustion = remainingBudgetHours / averageDailyHours;
	const exhaustion = now.add({
		milliseconds: Math.round(daysUntilExhaustion * MILLISECONDS_PER_DAY),
	});
	const deadlineStart = deadlineDay.toZonedDateTime(timeZone).toInstant();
	const deadlineBufferMilliseconds = deadlineStart.epochMilliseconds - exhaustion.epochMilliseconds;

	if (deadlineBufferMilliseconds <= 0) {
		return { forecastSeverity: "none", forecastBudgetExhaustionDate: null, forecastMessage: null };
	}

	return {
		forecastSeverity:
			deadlineBufferMilliseconds <= 3 * MILLISECONDS_PER_DAY ? "critical" : "warning",
		forecastBudgetExhaustionDate: dateFromInstant(exhaustion),
		forecastMessage: `${projectName} budget may be exhausted before its deadline at the current burn rate.`,
	};
}

function severityRank(project: ProjectSummary): number {
	if (
		[project.budgetSeverity, project.deadlineSeverity, project.forecastSeverity].includes(
			"critical",
		)
	) {
		return 2;
	}

	if (
		[project.budgetSeverity, project.deadlineSeverity, project.forecastSeverity].includes("warning")
	) {
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
