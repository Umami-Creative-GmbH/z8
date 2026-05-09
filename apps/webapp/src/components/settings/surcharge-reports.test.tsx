/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
	employee: { id: "employee-1", firstName: "Mina", lastName: "Miller" },
};

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
			expect(screen.getByText("1 calculation")).toBeInTheDocument();
		});
		const [organizationId, startDate, endDate, employeeId] =
			getSurchargeCalculationsForPeriodMock.mock.calls[0] ?? [];
		expect(organizationId).toBe("org-1");
		expect(startDate).toBeInstanceOf(Date);
		expect(endDate).toBeInstanceOf(Date);
		expect(employeeId).toBeUndefined();

		expect(screen.getByText("8h 0m")).toBeInTheDocument();
		expect(screen.getByText("2h 0m")).toBeInTheDocument();
		expect(screen.getByText("0h 30m")).toBeInTheDocument();
		expect(screen.getByText("Mina Miller")).toBeInTheDocument();
		expect(screen.getByText("25%")).toBeInTheDocument();
	});

	it("renders an empty state when no calculations match", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({ success: true, data: [] });

		render(<SurchargeReports organizationId="org-1" />);

		await waitFor(() => {
			expect(screen.getByText("No surcharge calculations found")).toBeInTheDocument();
		});
		expect(
			screen.getByText("No surcharge calculations matched the selected filters."),
		).toBeInTheDocument();
	});

	it("expands a calculation row to show audit details", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({
			success: true,
			data: [calculation],
		});

		render(<SurchargeReports organizationId="org-1" />);

		const detailsButton = await screen.findByRole("button", { name: "Show details for Mina Miller" });
		fireEvent.click(detailsButton);

		expect(screen.getByText("Applied rules")).toBeInTheDocument();
		expect(screen.getByText("Night premium")).toBeInTheDocument();
		expect(screen.getByText("time_window")).toBeInTheDocument();
		expect(screen.getByText("Overlap policy: max_wins")).toBeInTheDocument();
	});

	it("validates date ranges before fetching", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({ success: true, data: [] });

		render(<SurchargeReports organizationId="org-1" />);

		await screen.findByText("No surcharge calculations found");
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

		expect(await screen.findByText("Start date must be on or before end date.")).toBeInTheDocument();
		await Promise.resolve();
		await waitFor(() => {
			expect(getSurchargeCalculationsForPeriodMock).toHaveBeenCalledTimes(0);
		});
	});
});
