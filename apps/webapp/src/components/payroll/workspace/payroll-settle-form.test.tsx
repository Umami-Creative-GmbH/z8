// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayrollPeriodEmployee } from "@/lib/payroll-period/types";
import { PayrollSettleForm } from "./payroll-settle-form";

const actions = vi.hoisted(() => ({
	previewSettlePayrollDaysAction: vi.fn(),
	settlePayrollDaysAction: vi.fn(),
	unsettlePayrollDaysAction: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

const t = vi.hoisted(
	() => (_key: string, fallback: string, params?: Record<string, string | number>) =>
		Object.entries(params ?? {}).reduce(
			(message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
			fallback,
		),
);

vi.mock("@/app/[locale]/(app)/payroll/actions", () => actions);
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: toastMocks }));

function employee(id: string, name: string): PayrollPeriodEmployee {
	return {
		id,
		name,
		employeeNumber: null,
		teamName: null,
		contractType: "fixed",
		timezone: "Europe/Berlin",
		days: [],
		totals: { creditedMinutes: 0, requiredMinutes: null, differenceMinutes: null, absenceDays: 0 },
	} as PayrollPeriodEmployee;
}

const employees = [employee("anna", "Anna Arendt"), employee("ben", "Ben Becker")];
const request = { startDate: "2026-11-01", endDate: "2026-11-30", label: "November 2026" };
const counts = {
	newDays: 3,
	alreadySettledDays: 1,
	unclosedMonths: [],
	skippedWithoutEntriesDays: 4,
	skippedPendingAbsenceDays: 1,
	skippedUnclosedMonthDays: 0,
	pendingAbsenceDays: 0,
	employees: [{ employeeId: "ben", name: "Ben Becker", days: 3, creditedMinutes: 1_440 }],
};

function renderForm() {
	const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<PayrollSettleForm employees={employees} request={request} t={t} />
		</QueryClientProvider>,
	);
}

describe("PayrollSettleForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actions.previewSettlePayrollDaysAction.mockResolvedValue({ success: true, data: counts });
		actions.settlePayrollDaysAction.mockResolvedValue({ success: true, data: counts });
	});
	afterEach(cleanup);

	it("previews the whole period for everyone, leaving out pending absences by default", async () => {
		renderForm();

		fireEvent.click(screen.getByRole("button", { name: "Preview and settle…" }));

		await waitFor(() =>
			expect(actions.previewSettlePayrollDaysAction).toHaveBeenCalledExactlyOnceWith({
				startDate: "2026-11-01",
				endDate: "2026-11-30",
				label: "November 2026",
				employeeIds: undefined,
				skipUnclosedMonths: false,
				skipPendingAbsences: true,
			}),
		);
	});

	it("needs a chosen employee when not settling everyone", async () => {
		renderForm();

		fireEvent.click(screen.getByRole("checkbox", { name: "All 2 employees in the current scope" }));
		fireEvent.click(screen.getByRole("button", { name: "Preview and settle…" }));

		expect(await screen.findByText("Choose at least one employee")).toBeTruthy();
		expect(actions.previewSettlePayrollDaysAction).not.toHaveBeenCalled();
	});

	it("settles the chosen employees and range after the preview", async () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-09" } });
		fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-15" } });
		fireEvent.click(screen.getByRole("checkbox", { name: "All 2 employees in the current scope" }));
		fireEvent.change(screen.getByRole("searchbox", { name: "Search employees" }), {
			target: { value: "beck" },
		});
		expect(screen.queryByRole("checkbox", { name: "Anna Arendt" })).toBeNull();
		fireEvent.click(screen.getByRole("checkbox", { name: "Ben Becker" }));
		fireEvent.click(
			screen.getByRole("checkbox", { name: "Skip days in months that are not closed" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Preview and settle…" }));

		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("Days without entries, never settled")).toBeTruthy();
		expect(within(dialog).getByText("Days with pending absences, skipped")).toBeTruthy();
		const breakdown = within(dialog).getByRole("table");
		expect(within(breakdown).getByRole("rowheader", { name: "Ben Becker" })).toBeTruthy();
		expect(within(breakdown).getByText("24")).toBeTruthy();

		fireEvent.click(within(dialog).getByRole("button", { name: "Settle 3 days" }));

		const expected = {
			startDate: "2026-11-09",
			endDate: "2026-11-15",
			label: "November 2026",
			employeeIds: ["ben"],
			skipUnclosedMonths: true,
			skipPendingAbsences: true,
		};
		await waitFor(() =>
			expect(actions.settlePayrollDaysAction).toHaveBeenCalledExactlyOnceWith(expected),
		);
		expect(actions.previewSettlePayrollDaysAction).toHaveBeenCalledWith(expected);
		await waitFor(() => expect(toastMocks.success).toHaveBeenCalledWith("3 days settled"));
	});

	it("filters on Enter in the employee search without submitting the form", () => {
		renderForm();

		fireEvent.click(screen.getByRole("checkbox", { name: "All 2 employees in the current scope" }));
		const search = screen.getByRole("searchbox", { name: "Search employees" });
		fireEvent.change(search, { target: { value: "beck" } });

		// fireEvent returns false when the handler cancelled the event's default action,
		// here the form's implicit submission.
		expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
		expect(fireEvent.keyDown(search, { key: "a" })).toBe(true);
		expect(screen.getByRole("checkbox", { name: "Ben Becker" })).toBeTruthy();
		expect(actions.previewSettlePayrollDaysAction).not.toHaveBeenCalled();
	});

	it("keeps the dates inside the period", async () => {
		renderForm();

		fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-31" } });
		fireEvent.click(screen.getByRole("button", { name: "Preview and settle…" }));

		expect(await screen.findByText("Choose a date from 2026-11-01 to 2026-11-30")).toBeTruthy();
		expect(actions.previewSettlePayrollDaysAction).not.toHaveBeenCalled();
	});
});
