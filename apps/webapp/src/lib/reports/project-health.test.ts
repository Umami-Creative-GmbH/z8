import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	buildProjectHealthFields,
	buildProjectHealthTotals,
	hasProjectHealthAlert,
	sortProjectHealthAlerts,
} from "./project-health";
import type { ProjectSummary } from "./project-types";

const now = Temporal.Instant.from("2026-05-09T12:00:00Z");
const timeZone = "UTC";
// 1–10 May, both inclusive: ten report days.
const range = {
	fromDay: Temporal.PlainDate.from("2026-05-01"),
	toDay: Temporal.PlainDate.from("2026-05-10"),
};

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
			buildProjectHealthFields({
				projectName: "Budget 70",
				rangeHours: 0,
				cumulativeHours: 70,
				budgetHours: 100,
				deadline: null,
				now,
				timeZone,
				range,
			}),
		).toMatchObject({ budgetSeverity: "warning", budgetAlertType: "budget_70" });
		expect(
			buildProjectHealthFields({
				projectName: "Budget 90",
				rangeHours: 0,
				cumulativeHours: 90,
				budgetHours: 100,
				deadline: null,
				now,
				timeZone,
				range,
			}),
		).toMatchObject({ budgetSeverity: "warning", budgetAlertType: "budget_90" });
		expect(
			buildProjectHealthFields({
				projectName: "Budget 100",
				rangeHours: 0,
				cumulativeHours: 100,
				budgetHours: 100,
				deadline: null,
				now,
				timeZone,
				range,
			}),
		).toMatchObject({ budgetSeverity: "critical", budgetAlertType: "budget_100" });
	});

	it("sets deadline alerts for 14 days, 7 days, 1 day, today, and overdue", () => {
		expect(
			buildProjectHealthFields({
				projectName: "Deadline 14",
				rangeHours: 0,
				cumulativeHours: 0,
				budgetHours: null,
				deadline: new Date("2026-05-23T18:00:00.000Z"),
				now,
				timeZone,
				range,
			}),
		).toMatchObject({ deadlineSeverity: "warning", deadlineAlertType: "deadline_14d" });
		expect(
			buildProjectHealthFields({
				projectName: "Deadline 7",
				rangeHours: 0,
				cumulativeHours: 0,
				budgetHours: null,
				deadline: new Date("2026-05-16T18:00:00.000Z"),
				now,
				timeZone,
				range,
			}),
		).toMatchObject({ deadlineSeverity: "warning", deadlineAlertType: "deadline_7d" });
		expect(
			buildProjectHealthFields({
				projectName: "Deadline 1",
				rangeHours: 0,
				cumulativeHours: 0,
				budgetHours: null,
				deadline: new Date("2026-05-10T18:00:00.000Z"),
				now,
				timeZone,
				range,
			}),
		).toMatchObject({ deadlineSeverity: "critical", deadlineAlertType: "deadline_1d" });
		expect(
			buildProjectHealthFields({
				projectName: "Deadline Today",
				rangeHours: 0,
				cumulativeHours: 0,
				budgetHours: null,
				deadline: new Date("2026-05-09T18:00:00.000Z"),
				now,
				timeZone,
				range,
			}),
		).toMatchObject({ deadlineSeverity: "critical", deadlineAlertType: "deadline_today" });
		expect(
			buildProjectHealthFields({
				projectName: "Deadline Overdue",
				rangeHours: 0,
				cumulativeHours: 0,
				budgetHours: null,
				deadline: new Date("2026-05-08T18:00:00.000Z"),
				now,
				timeZone,
				range,
			}),
		).toMatchObject({ deadlineSeverity: "critical", deadlineAlertType: "deadline_overdue" });
	});

	it("counts the calendar days from today to the deadline day", () => {
		const daysUntil = (deadline: string, at = now) =>
			buildProjectHealthFields({
				projectName: "Days",
				rangeHours: 0,
				cumulativeHours: 0,
				budgetHours: null,
				// The project form stores the deadline day as its UTC midnight.
				deadline: new Date(deadline),
				now: at,
				timeZone,
				range,
			}).daysUntilDeadline;

		expect(daysUntil("2026-05-23")).toBe(14);
		expect(daysUntil("2026-05-09")).toBe(0);
		expect(daysUntil("2026-05-06")).toBe(-3);
		// Late in the evening the deadline is still one calendar day away, not under a day.
		expect(daysUntil("2026-05-10", Temporal.Instant.from("2026-05-09T23:59:00Z"))).toBe(1);
		expect(
			buildProjectHealthFields({
				projectName: "No Deadline",
				rangeHours: 0,
				cumulativeHours: 0,
				budgetHours: null,
				deadline: null,
				now,
				timeZone,
				range,
			}).daysUntilDeadline,
		).toBeNull();
	});

	it("takes today's date in the organization's timezone, not the server's or the viewer's", () => {
		// 23:30 UTC on 9 May is already 10 May in Berlin, and still 9 May in New York.
		const lateEvening = Temporal.Instant.from("2026-05-09T23:30:00Z");
		const deadlineOn10May = (zone: string) =>
			buildProjectHealthFields({
				projectName: "Zoned",
				rangeHours: 0,
				cumulativeHours: 0,
				budgetHours: null,
				deadline: new Date("2026-05-10T00:00:00.000Z"),
				now: lateEvening,
				timeZone: zone,
				range,
			});

		expect(deadlineOn10May("Europe/Berlin")).toMatchObject({
			daysUntilDeadline: 0,
			deadlineAlertType: "deadline_today",
		});
		expect(deadlineOn10May("America/New_York")).toMatchObject({
			daysUntilDeadline: 1,
			deadlineAlertType: "deadline_1d",
		});
	});

	it("spreads range hours over every report day, both ends included", () => {
		const oneDay = buildProjectHealthFields({
			projectName: "One Day",
			rangeHours: 10,
			cumulativeHours: 10,
			budgetHours: 30,
			deadline: new Date("2026-05-20T00:00:00.000Z"),
			now,
			timeZone,
			range: { fromDay: range.fromDay, toDay: range.fromDay },
		});

		// A single report day burns all 10 hours a day; the remaining 20 last two days.
		expect(oneDay.forecastBudgetExhaustionDate?.toISOString()).toBe("2026-05-11T12:00:00.000Z");
	});

	it("forecasts selected-range burn rate budget exhaustion before deadline", () => {
		const result = buildProjectHealthFields({
			projectName: "Forecast Risk",
			rangeHours: 80,
			cumulativeHours: 80,
			budgetHours: 100,
			deadline: new Date("2026-05-20T00:00:00.000Z"),
			now,
			timeZone,
			range,
		});

		// 80 hours over ten report days is 8 a day; the remaining 20 last 2.5 days.
		expect(result.forecastSeverity).toBe("warning");
		expect(result.forecastBudgetExhaustionDate?.toISOString()).toBe("2026-05-12T00:00:00.000Z");
		expect(result.forecastMessage).toBe(
			"Forecast Risk budget may be exhausted before its deadline at the current burn rate.",
		);
	});

	it("uses cumulative hours for remaining budget and selected-range hours for forecast burn rate", () => {
		const result = buildProjectHealthFields({
			projectName: "Cumulative Forecast Risk",
			rangeHours: 20,
			cumulativeHours: 95,
			budgetHours: 100,
			deadline: new Date("2026-05-20T00:00:00.000Z"),
			now,
			timeZone,
			range,
		});

		expect(result).toMatchObject({ budgetSeverity: "warning", budgetAlertType: "budget_90" });
		expect(result.forecastSeverity).toBe("warning");
		expect(result.forecastBudgetExhaustionDate?.toISOString()).toBe("2026-05-12T00:00:00.000Z");
	});

	it("does not forecast without average daily hours, budget, or deadline", () => {
		const base = { projectName: "No Forecast", now, timeZone, range };

		expect(
			buildProjectHealthFields({
				...base,
				rangeHours: 0,
				cumulativeHours: 10,
				budgetHours: 100,
				deadline: new Date("2026-05-20"),
			}),
		).toMatchObject({
			forecastSeverity: "none",
			forecastBudgetExhaustionDate: null,
			forecastMessage: null,
		});
		expect(
			buildProjectHealthFields({
				...base,
				rangeHours: 10,
				cumulativeHours: 10,
				budgetHours: null,
				deadline: new Date("2026-05-20"),
			}),
		).toMatchObject({
			forecastSeverity: "none",
			forecastBudgetExhaustionDate: null,
			forecastMessage: null,
		});
		expect(
			buildProjectHealthFields({
				...base,
				rangeHours: 10,
				cumulativeHours: 10,
				budgetHours: 100,
				deadline: null,
			}),
		).toMatchObject({
			forecastSeverity: "none",
			forecastBudgetExhaustionDate: null,
			forecastMessage: null,
		});
	});
});

describe("project health totals and alerts", () => {
	it("counts budget health totals", () => {
		const totals = buildProjectHealthTotals([
			buildSummary({
				percentBudgetUsed: 70,
				budgetSeverity: "warning",
				budgetAlertType: "budget_70",
			}),
			buildSummary({
				percentBudgetUsed: 90,
				budgetSeverity: "warning",
				budgetAlertType: "budget_90",
			}),
			buildSummary({
				percentBudgetUsed: 100,
				budgetSeverity: "critical",
				budgetAlertType: "budget_100",
			}),
			buildSummary({
				forecastSeverity: "warning",
				forecastBudgetExhaustionDate: new Date("2026-05-11T18:00:00.000Z"),
			}),
		]);

		expect(totals).toEqual({
			projectsAtOrAbove70Budget: 3,
			projectsAtOrAbove90Budget: 2,
			projectsOverBudget: 1,
			projectsForecastAtRisk: 1,
		});
	});

	it("sorts alerts by severity and risk", () => {
		const lowBudget = buildSummary({
			id: "low-budget",
			name: "Low Budget",
			budgetSeverity: "warning",
			budgetAlertType: "budget_70",
			percentBudgetUsed: 70,
		});
		const highBudget = buildSummary({
			id: "high-budget",
			name: "High Budget",
			budgetSeverity: "warning",
			budgetAlertType: "budget_90",
			percentBudgetUsed: 90,
		});
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

		expect(
			sortProjectHealthAlerts([lowBudget, laterCritical, highBudget, overdue]).map(
				(project) => project.id,
			),
		).toEqual(["overdue", "later-critical", "high-budget", "low-budget"]);
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

		expect(
			sortProjectHealthAlerts([deadlineWarning, forecastRisk]).map((project) => project.id),
		).toEqual(["forecast-risk", "deadline-warning"]);
	});
});
