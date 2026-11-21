// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PayrollPeriodDay, PayrollPeriodEmployee } from "@/lib/payroll-period/types";
import { payrollDaysFormat } from "./payroll-day-format";
import { settleableGroups } from "./payroll-day-selection";
import type { PayrollDayPicking } from "./payroll-days-grid";
import { PayrollDaysList } from "./payroll-days-list";

const t = (_key: string, fallback: string, params?: Record<string, string | number>) =>
	Object.entries(params ?? {}).reduce(
		(message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
		fallback,
	);

function day(date: string, kind: "work" | "empty" | "settled"): PayrollPeriodDay {
	return {
		date,
		creditedMinutes: kind === "empty" ? 0 : 480,
		requiredMinutes: 480,
		differenceMinutes: kind === "empty" ? -480 : 0,
		absences: [],
		holiday: null,
		hasEntries: kind !== "empty",
		settlement:
			kind === "settled"
				? {
						state: "settled",
						settledDayId: `settled-${date}`,
						method: "manual",
						payrollExportJobId: null,
						settledAt: "2026-11-20T10:00:00.000Z",
						paid: { creditedMinutes: 480, absences: [] },
					}
				: { state: "unsettled" },
	};
}

function employee(name: string, days: PayrollPeriodDay[]): PayrollPeriodEmployee {
	return {
		id: name.toLowerCase(),
		name,
		employeeNumber: null,
		teamName: null,
		contractType: "fixed",
		timezone: "Europe/Berlin",
		days,
		totals: { creditedMinutes: 0, requiredMinutes: null, differenceMinutes: null, absenceDays: 0 },
	} as PayrollPeriodEmployee;
}

function renderList(employees: PayrollPeriodEmployee[]) {
	const picking: PayrollDayPicking = {
		selected: new Set(),
		groups: settleableGroups(employees),
		onToggleDay: vi.fn(),
		onToggleEmployee: vi.fn(),
		onToggleDate: vi.fn(),
	};
	render(
		<PayrollDaysList
			employees={employees}
			format={payrollDaysFormat("en")}
			onSelectDay={vi.fn()}
			picking={picking}
			t={t}
		/>,
	);
	return picking;
}

describe("PayrollDaysList while picking days", () => {
	afterEach(cleanup);

	it("disables selecting an employee's days when none can be settled, and says why", () => {
		const picking = renderList([
			employee("Anna", [day("2026-11-01", "settled"), day("2026-11-02", "empty")]),
		]);

		const button = screen.getByRole("button", { name: "Select every day of Anna to settle" });
		expect((button as HTMLButtonElement).disabled).toBe(true);
		expect(
			screen.getByText("Anna has no unsettled days with entries in this period."),
		).toBeTruthy();
		fireEvent.click(button);
		expect(picking.onToggleEmployee).not.toHaveBeenCalled();
	});

	it("selects an employee's days when some can be settled", () => {
		const picking = renderList([
			employee("Ben", [day("2026-11-01", "work"), day("2026-11-02", "empty")]),
		]);

		const button = screen.getByRole("button", { name: "Select every day of Ben to settle" });
		expect((button as HTMLButtonElement).disabled).toBe(false);
		expect(button.getAttribute("aria-pressed")).toBe("false");
		fireEvent.click(button);
		expect(picking.onToggleEmployee).toHaveBeenCalledOnce();
	});
});
