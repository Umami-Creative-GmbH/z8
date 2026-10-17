/* @vitest-environment jsdom */

import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
	VacationBalance,
	VacationBalanceConfiguration,
} from "@/lib/absences/types";
import { render } from "@/test/render-with-translations";
import { EmployeeAllowancesView } from "./employee-allowances-view";

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));

const t = ((_key: string, fallback: string, params?: Record<string, unknown>) =>
	fallback.replace(/\{(\w+)\}/g, (_match, name: string) =>
		String(params?.[name] ?? ""),
	)) as never;

const balance: VacationBalance = {
	year: 2026,
	totalDays: 23,
	allowanceDays: 20,
	usedDays: 0,
	pendingDays: 0,
	remainingDays: 23,
	overdrawnDays: 0,
	carryoverDays: 1,
	allowance: {
		fullAllowance: 20,
		days: 20,
		reason: { kind: "none", cause: "full_year" },
	},
};

function renderRow(input: {
	vacationBalance: VacationBalance | null;
	vacationConfiguration?: VacationBalanceConfiguration;
	vacationAdjustments: { manual: number; accrual: number } | null;
}) {
	render(
		<EmployeeAllowancesView
			currentYear={2026}
			defaultDays="20"
			employees={[
				{
					id: "employee-1",
					user: { name: "Ada", email: "ada@example.test", image: null },
					team: null,
					vacationAllowances: [],
					...input,
				},
			]}
			hasOrganizationPolicy
			policyAssignments={[]}
			t={t}
		/>,
	);
	const [header, row] = screen.getAllByRole("row");
	const headers = within(header)
		.getAllByRole("columnheader")
		.map((cell) => cell.textContent);
	const cells = within(row).getAllByRole("cell");
	return (column: string) => cells[headers.indexOf(column)]?.textContent;
}

describe("EmployeeAllowancesView", () => {
	it("shows manual adjustments and accrual in their own columns, with the server's total", () => {
		const cell = renderRow({
			vacationBalance: balance,
			vacationAdjustments: { manual: -2, accrual: 4 },
		});

		expect(cell("Allowance")).toContain("20");
		expect(cell("Carryover")).toBe("+1");
		expect(cell("Adjustments")).toBe("-2");
		expect(cell("Accrued")).toBe("+4");
		expect(cell("Total Available")).toBe("23");
	});

	it("shows no balance figures when policy configuration is unavailable", () => {
		const cell = renderRow({
			vacationBalance: null,
			vacationAdjustments: null,
		});

		for (const column of [
			"Allowance",
			"Carryover",
			"Adjustments",
			"Accrued",
			"Total Available",
		]) {
			expect(cell(column)).toBe("—");
		}
	});
	it.each(["missing", "conflict"] as const)(
		"shows %s policy configuration without vacation figures",
		(status) => {
			const cell = renderRow({
				vacationBalance: null,
				vacationConfiguration: {
					status,
					periods: [{ startDate: "2026-01-01", endDate: "2026-12-31" }],
				},
				vacationAdjustments: null,
			});
			expect(cell("Policy")).toContain(
				status === "missing"
					? "Missing vacation policy"
					: "Conflicting vacation policies",
			);
			for (const column of [
				"Allowance",
				"Carryover",
				"Adjustments",
				"Accrued",
				"Total Available",
			]) {
				expect(cell(column)).toBe("—");
			}
		},
	);
});
