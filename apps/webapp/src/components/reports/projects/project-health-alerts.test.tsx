/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ProjectSummary } from "@/lib/reports/project-types";
import { ProjectHealthAlerts } from "./project-health-alerts";

const PROJECT_DEADLINE = new Date("2026-05-20T00:00:00.000Z");
const FORECAST_EXHAUSTION_DATE = new Date("2026-05-15T00:00:00.000Z");

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replace(`{${key}}`, String(value)),
				fallback ?? _key,
			),
	}),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	CardDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: { children: ReactNode } & ComponentProps<"button">) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));

function buildProject(overrides: Partial<ProjectSummary>): ProjectSummary {
	return {
		id: "project-1",
		name: "Migration Rollout",
		description: null,
		status: "active",
		color: null,
		budgetHours: 100,
		deadline: PROJECT_DEADLINE,
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

describe("ProjectHealthAlerts", () => {
	it("renders an empty state when projects have no alerts", () => {
		render(
			<ProjectHealthAlerts
				projects={[buildProject({ id: "healthy", name: "Healthy Project" })]}
				onProjectSelect={vi.fn()}
			/>,
		);

		expect(screen.getByText("No budget or deadline risks in this report period.")).toBeTruthy();
	});

	it("renders budget and forecast alert details with a details action", () => {
		const onProjectSelect = vi.fn();
		const forecastMessage =
			"Migration Rollout budget may be exhausted before its deadline at the current burn rate.";

		render(
			<ProjectHealthAlerts
				projects={[
					buildProject({
						id: "migration-rollout",
						name: "Migration Rollout",
						budgetSeverity: "warning",
						budgetAlertType: "budget_90",
						forecastSeverity: "critical",
						forecastBudgetExhaustionDate: FORECAST_EXHAUSTION_DATE,
						forecastMessage,
						percentBudgetUsed: 92,
						daysUntilDeadline: 5,
						totalHours: 92,
						totalMinutes: 5520,
						uniqueEmployees: 4,
						workPeriodCount: 18,
					}),
				]}
				onProjectSelect={onProjectSelect}
			/>,
		);

		expect(screen.getByText("Migration Rollout")).toBeTruthy();
		expect(screen.getByText("Critical")).toBeTruthy();
		expect(screen.getByText("92% budget used")).toBeTruthy();
		expect(screen.getByText("5d left")).toBeTruthy();
		expect(screen.getByText(forecastMessage)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "View details for Migration Rollout" }));

		expect(onProjectSelect).toHaveBeenCalledWith("migration-rollout");
	});
});
