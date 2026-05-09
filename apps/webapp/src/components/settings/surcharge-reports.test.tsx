/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SurchargeReports } from "./surcharge-reports";

const getSurchargeCalculationsForPeriodMock = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("@/app/[locale]/(app)/settings/surcharges/actions", () => ({
	getSurchargeCalculationsForPeriod: (...args: unknown[]) =>
		getSurchargeCalculationsForPeriodMock(...args),
}));

const calculation = {
	id: "calc-1",
	employeeId: "employee-1",
	organizationId: "org-1",
	workPeriodId: "wp-1",
	surchargeRuleId: "rule-1",
	surchargeModelId: "model-1",
	calculationDate: new Date("2026-02-10T00:00:00.000Z"),
	baseMinutes: 480,
	qualifyingMinutes: 120,
	surchargeMinutes: 30,
	appliedPercentage: "0.25",
	calculationDetails: {
		workPeriodStartTime: "2026-02-10T20:00:00.000Z",
		workPeriodEndTime: "2026-02-11T04:00:00.000Z",
		rulesApplied: [
			{
				ruleId: "rule-1",
				ruleName: "Night premium",
				ruleType: "time_window",
				percentage: 0.25,
				qualifyingMinutes: 120,
				surchargeMinutes: 30,
			},
		],
		overlapPolicy: "max_wins",
		calculatedAt: "2026-02-11T04:05:00.000Z",
	},
	createdAt: new Date("2026-02-11T04:05:00.000Z"),
	employee: {
		id: "employee-1",
		firstName: "Mina",
		lastName: "Miller",
		name: "Mina Miller",
		email: "mina@example.com",
	},
};

const laterCalculation = {
	...calculation,
	id: "calc-2",
	employeeId: "employee-2",
	organizationId: "org-2",
	employee: {
		id: "employee-2",
		firstName: "Nora",
		lastName: "Nguyen",
		name: "Nora Nguyen",
		email: "nora@example.com",
	},
};

const rowLimitCalculations = Array.from({ length: 500 }, (_, index) => ({
	...calculation,
	id: `calc-limit-${index}`,
	employeeId: `employee-limit-${index}`,
	employee: {
		...calculation.employee,
		id: `employee-limit-${index}`,
	},
}));

function deferredResult(data: unknown[]) {
	let resolve: (value: { success: true; data: unknown[] }) => void = () => {};
	const promise = new Promise<{ success: true; data: unknown[] }>((promiseResolve) => {
		resolve = promiseResolve;
	});

	return { promise, resolve: () => resolve({ success: true, data }) };
}

describe("SurchargeReports", () => {
	beforeEach(() => {
		getSurchargeCalculationsForPeriodMock.mockReset();
	});

	it("loads calculations and renders summary totals", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({
			success: true,
			data: [calculation],
		});

		render(<SurchargeReports organizationId="org-1" />);

		await waitFor(() => {
			expect(screen.getByText("1 calculation")).toBeTruthy();
		});
		const [organizationId, startDate, endDate, employeeId] =
			getSurchargeCalculationsForPeriodMock.mock.calls[0] ?? [];
		expect(organizationId).toBe("org-1");
		expect(startDate).toBeInstanceOf(Date);
		expect(endDate).toBeInstanceOf(Date);
		expect(employeeId).toBeUndefined();

		expect(screen.getByText("8h 0m")).toBeTruthy();
		expect(screen.getByText("2h 0m")).toBeTruthy();
		expect(screen.getByText("0h 30m")).toBeTruthy();
		expect(screen.getByText("Mina Miller")).toBeTruthy();
		expect(screen.getByText("25%")).toBeTruthy();
	});

	it("renders an empty state when no calculations match", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({ success: true, data: [] });

		render(<SurchargeReports organizationId="org-1" />);

		await waitFor(() => {
			expect(screen.getByText("No surcharge calculations found")).toBeTruthy();
		});
		expect(
			screen.getByText("No surcharge calculations matched the selected filters."),
		).toBeTruthy();
	});

	it("expands a calculation row to show audit details", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({
			success: true,
			data: [calculation],
		});

		render(<SurchargeReports organizationId="org-1" />);

		const detailsButton = await screen.findByRole("button", {
			name: "Show details for Mina Miller",
		});
		expect(detailsButton.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(detailsButton);
		const detailsId = detailsButton.getAttribute("aria-controls");

		expect(detailsButton.getAttribute("aria-expanded")).toBe("true");
		expect(detailsId).toBeTruthy();
		expect(document.getElementById(detailsId ?? "")).toBeTruthy();
		expect(screen.getByText("Applied rules")).toBeTruthy();
		expect(screen.getByText("Night premium")).toBeTruthy();
		expect(screen.getByText("time_window")).toBeTruthy();
		expect(screen.getByText("Overlap policy: max_wins")).toBeTruthy();
	});

	it("validates date ranges before fetching", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({
			success: true,
			data: [calculation],
		});

		render(<SurchargeReports organizationId="org-1" />);

		const detailsButton = await screen.findByRole("button", {
			name: "Show details for Mina Miller",
		});
		fireEvent.click(detailsButton);
		expect(screen.getByText("Night premium")).toBeTruthy();
		expect(getSurchargeCalculationsForPeriodMock).toHaveBeenCalledTimes(1);
		getSurchargeCalculationsForPeriodMock.mockClear();

		const form = screen.getByTestId("surcharge-report-filters");
		fireEvent.change(within(form).getByLabelText("Start date"), {
			target: { value: "2026-03-10" },
		});
		fireEvent.change(within(form).getByLabelText("End date"), {
			target: { value: "2026-03-01" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

		expect(await screen.findByText("Start date must be on or before end date.")).toBeTruthy();
		expect(screen.queryByText("Mina Miller")).toBeNull();
		expect(screen.queryByText("Night premium")).toBeNull();
		expect(screen.getByText("No surcharge calculations found")).toBeTruthy();
		await Promise.resolve();
		await waitFor(() => {
			expect(getSurchargeCalculationsForPeriodMock).toHaveBeenCalledTimes(0);
		});
	});

	it("preserves previous same-organization rows when a later load fails", async () => {
		getSurchargeCalculationsForPeriodMock
			.mockResolvedValueOnce({ success: true, data: [calculation] })
			.mockResolvedValueOnce({ success: false, error: "Failed to fetch calculations" });

		render(<SurchargeReports organizationId="org-1" />);

		expect(await screen.findByText("Mina Miller")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

		expect(await screen.findByText("Showing previous results.")).toBeTruthy();
		expect(screen.getByText("Mina Miller")).toBeTruthy();
	});

	it("shows a notice when the returned report reaches the row limit", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({
			success: true,
			data: rowLimitCalculations,
		});

		render(<SurchargeReports organizationId="org-1" />);

		expect(
			await screen.findByText(
				"Showing the first 500 matching calculations. Narrow the date or employee filters to refine totals.",
			),
		).toBeTruthy();
	});

	it("waits for apply before fetching edited filters", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValue({ success: true, data: [] });

		render(<SurchargeReports organizationId="org-1" />);

		await screen.findByText("No surcharge calculations found");
		expect(getSurchargeCalculationsForPeriodMock).toHaveBeenCalledTimes(1);
		getSurchargeCalculationsForPeriodMock.mockClear();

		const form = screen.getByTestId("surcharge-report-filters");
		fireEvent.change(within(form).getByLabelText("Employee ID"), {
			target: { value: "employee-2" },
		});

		await Promise.resolve();
		expect(getSurchargeCalculationsForPeriodMock).toHaveBeenCalledTimes(0);

		fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

		await waitFor(() => {
			expect(getSurchargeCalculationsForPeriodMock).toHaveBeenCalledTimes(1);
		});
	});

	it("ignores stale responses from earlier requests", async () => {
		const firstRequest = deferredResult([calculation]);
		const secondRequest = deferredResult([laterCalculation]);
		getSurchargeCalculationsForPeriodMock
			.mockReturnValueOnce(firstRequest.promise)
			.mockReturnValueOnce(secondRequest.promise);

		const { rerender } = render(<SurchargeReports organizationId="org-1" />);
		rerender(<SurchargeReports organizationId="org-2" />);

		await act(async () => {
			secondRequest.resolve();
			await secondRequest.promise;
		});
		expect(await screen.findByText("Nora Nguyen")).toBeTruthy();

		await act(async () => {
			firstRequest.resolve();
			await firstRequest.promise;
		});

		expect(screen.getByText("Nora Nguyen")).toBeTruthy();
		expect(screen.queryByText("Mina Miller")).toBeNull();
	});
});
