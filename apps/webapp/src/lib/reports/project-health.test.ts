import { describe, expect, it } from "vitest";

import type { ProjectSummary } from "./project-types";
import {
	buildProjectHealthFields,
	buildProjectHealthTotals,
	hasProjectHealthAlert,
	sortProjectHealthAlerts,
} from "./project-health";

const now = new Date("2026-05-09T12:00:00.000Z");
const rangeStart = new Date("2026-05-01T00:00:00.000Z");
const rangeEnd = new Date("2026-05-10T00:00:00.000Z");

function buildSummary(overrides: Partial<ProjectSummary>): ProjectSummary {
	return {
		id: "project-1",
		name: "Project 1",
		description: null,
		status: "active",
		color: null,
		budgetHours: null,
		deadline: null,
		budgetSeverity: "none",
		budgetAlertType: null,
		deadlineSeverity: "none",
		deadlineAlertType: null,
		forecastSeverity: "none",
		forecastBudgetExhaustionDate: null,
		forecastMessage: null,
		totalHours: 0,
		totalMinutes: 0,
		percentBudgetUsed: null,
		daysUntilDeadline: null,
		uniqueEmployees: 0,
		workPeriodCount: 0,
		...overrides,
	};
}

describe("buildProjectHealthFields", () => {
	it("sets budget alerts at 70, 90, and 100 percent thresholds", () => {
		expect(
			buildProjectHealthFields({ projectName: "Budget 70", totalHours: 70, budgetHours: 100, deadline: null, now, rangeStart, rangeEnd }),
		).toMatchObject({ budgetSeverity: "warning", budgetAlertType: "budget_70" });
		expect(
			buildProjectHealthFields({ projectName: "Budget 90", totalHours: 90, budgetHours: 100, deadline: null, now, rangeStart, rangeEnd }),
		).toMatchObject({ budgetSeverity: "warning", budgetAlertType: "budget_90" });
		expect(
			buildProjectHealthFields({ projectName: "Budget 100", totalHours: 100, budgetHours: 100, deadline: null, now, rangeStart, rangeEnd }),
		).toMatchObject({ budgetSeverity: "critical", budgetAlertType: "budget_100" });
	});

	it("sets deadline alerts for 14 days, 7 days, 1 day, today, and overdue", () => {
		expect(
			buildProjectHealthFields({
				projectName: "Deadline 14",
				totalHours: 0,
				budgetHours: null,
				deadline: new Date("2026-05-23T18:00:00.000Z"),
				now,
				rangeStart,
				rangeEnd,
			}),
		).toMatchObject({ deadlineSeverity: "warning", deadlineAlertType: "deadline_14d" });
		expect(
			buildProjectHealthFields({
				projectName: "Deadline 7",
				totalHours: 0,
				budgetHours: null,
				deadline: new Date("2026-05-16T18:00:00.000Z"),
				now,
				rangeStart,
				rangeEnd,
			}),
		).toMatchObject({ deadlineSeverity: "warning", deadlineAlertType: "deadline_7d" });
		expect(
			buildProjectHealthFields({
				projectName: "Deadline 1",
				totalHours: 0,
				budgetHours: null,
				deadline: new Date("2026-05-10T18:00:00.000Z"),
				now,
				rangeStart,
				rangeEnd,
			}),
		).toMatchObject({ deadlineSeverity: "critical", deadlineAlertType: "deadline_1d" });
		expect(
			buildProjectHealthFields({
				projectName: "Deadline Today",
				totalHours: 0,
				budgetHours: null,
				deadline: new Date("2026-05-09T18:00:00.000Z"),
				now,
				rangeStart,
				rangeEnd,
			}),
		).toMatchObject({ deadlineSeverity: "critical", deadlineAlertType: "deadline_today" });
		expect(
			buildProjectHealthFields({
				projectName: "Deadline Overdue",
				totalHours: 0,
				budgetHours: null,
				deadline: new Date("2026-05-08T18:00:00.000Z"),
				now,
				rangeStart,
				rangeEnd,
			}),
		).toMatchObject({ deadlineSeverity: "critical", deadlineAlertType: "deadline_overdue" });
	});

	it("forecasts selected-range burn rate budget exhaustion before deadline", () => {
		const result = buildProjectHealthFields({
			projectName: "Forecast Risk",
			totalHours: 80,
			budgetHours: 100,
			deadline: new Date("2026-05-20T00:00:00.000Z"),
			now,
			rangeStart,
			rangeEnd,
		});

		expect(result.forecastSeverity).toBe("warning");
		expect(result.forecastBudgetExhaustionDate?.toISOString()).toBe("2026-05-11T18:00:00.000Z");
		expect(result.forecastMessage).toBe(
			"Forecast Risk budget may be exhausted before its deadline at the current burn rate.",
		);
	});

	it("does not forecast without average daily hours, budget, or deadline", () => {
		const base = { projectName: "No Forecast", now, rangeStart, rangeEnd };

		expect(buildProjectHealthFields({ ...base, totalHours: 0, budgetHours: 100, deadline: new Date("2026-05-20") })).toMatchObject({
			forecastSeverity: "none",
			forecastBudgetExhaustionDate: null,
			forecastMessage: null,
		});
		expect(buildProjectHealthFields({ ...base, totalHours: 10, budgetHours: null, deadline: new Date("2026-05-20") })).toMatchObject({
			forecastSeverity: "none",
			forecastBudgetExhaustionDate: null,
			forecastMessage: null,
		});
		expect(buildProjectHealthFields({ ...base, totalHours: 10, budgetHours: 100, deadline: null })).toMatchObject({
			forecastSeverity: "none",
			forecastBudgetExhaustionDate: null,
			forecastMessage: null,
		});
	});
});

describe("project health totals and alerts", () => {
	it("counts budget health totals", () => {
		const totals = buildProjectHealthTotals([
			buildSummary({ percentBudgetUsed: 70, budgetSeverity: "warning", budgetAlertType: "budget_70" }),
			buildSummary({ percentBudgetUsed: 90, budgetSeverity: "warning", budgetAlertType: "budget_90" }),
			buildSummary({ percentBudgetUsed: 100, budgetSeverity: "critical", budgetAlertType: "budget_100" }),
			buildSummary({ forecastSeverity: "warning", forecastBudgetExhaustionDate: new Date("2026-05-11T18:00:00.000Z") }),
		]);

		expect(totals).toEqual({
			projectsAtOrAbove70Budget: 3,
			projectsAtOrAbove90Budget: 2,
			projectsOverBudget: 1,
			projectsForecastAtRisk: 1,
		});
	});

	it("sorts alerts by severity and risk", () => {
		const lowBudget = buildSummary({ id: "low-budget", name: "Low Budget", budgetSeverity: "warning", budgetAlertType: "budget_70", percentBudgetUsed: 70 });
		const highBudget = buildSummary({ id: "high-budget", name: "High Budget", budgetSeverity: "warning", budgetAlertType: "budget_90", percentBudgetUsed: 90 });
		const laterCritical = buildSummary({
			id: "later-critical",
			name: "Later Critical",
			deadline: new Date("2026-05-12T00:00:00.000Z"),
			deadlineSeverity: "critical",
			deadlineAlertType: "deadline_1d",
			percentBudgetUsed: 10,
		});
		const overdue = buildSummary({
			id: "overdue",
			name: "Overdue",
			deadline: new Date("2026-05-08T00:00:00.000Z"),
			deadlineSeverity: "critical",
			deadlineAlertType: "deadline_overdue",
			percentBudgetUsed: 50,
		});

		expect(sortProjectHealthAlerts([lowBudget, laterCritical, highBudget, overdue]).map((project) => project.id)).toEqual([
			"overdue",
			"later-critical",
			"high-budget",
			"low-budget",
		]);
		expect(hasProjectHealthAlert(lowBudget)).toBe(true);
		expect(hasProjectHealthAlert(buildSummary({ id: "healthy" }))).toBe(false);
	});

	it("sorts an earlier forecast risk before a later deadline-only warning", () => {
		const forecastRisk = buildSummary({
			id: "forecast-risk",
			name: "Forecast Risk",
			deadline: new Date("2026-05-30T00:00:00.000Z"),
			forecastSeverity: "warning",
			forecastBudgetExhaustionDate: new Date("2026-05-11T18:00:00.000Z"),
		});
		const deadlineWarning = buildSummary({
			id: "deadline-warning",
			name: "Deadline Warning",
			deadline: new Date("2026-05-16T00:00:00.000Z"),
			deadlineSeverity: "warning",
			deadlineAlertType: "deadline_7d",
		});

		expect(sortProjectHealthAlerts([deadlineWarning, forecastRisk]).map((project) => project.id)).toEqual([
			"forecast-risk",
			"deadline-warning",
		]);
	});
});
