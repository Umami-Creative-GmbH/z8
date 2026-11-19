/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SurchargeReports } from "./surcharge-reports-root";

const getSurchargeCalculationsForPeriodMock = vi.fn();
const translateMock = vi.fn(
	(_key: string, fallback?: string, params?: { count?: number }) => {
		const text = fallback ?? _key;
		// Resolve the "{count, plural, one {# x} other {# xs}}" form the summary strip uses.
		const plural = /^\{count, plural, one \{([^}]*)\} other \{([^}]*)\}\}$/.exec(text);
		if (plural && params?.count !== undefined) {
			return (params.count === 1 ? plural[1] : plural[2]).replace("#", String(params.count));
		}
		return text;
	},
);

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: translateMock }),
}));

vi.mock("@/app/[locale]/(app)/settings/surcharges/actions", () => ({
	getSurchargeCalculationsForPeriod: (...args: unknown[]) =>
		getSurchargeCalculationsForPeriodMock(...args),
}));

const employeeSelectPropsMock = vi.fn();

vi.mock("@/components/employee-select", () => ({
	EmployeeSingleSelect: (props: {
		value: string | null;
		onChange: (value: string | null) => void;
		label: string;
		placeholder: string;
		includeFormerEmployees?: boolean;
	}) => {
		employeeSelectPropsMock(props);
		return (
			<label>
				{props.label}
				<select
					value={props.value ?? ""}
					onChange={(event) => props.onChange(event.target.value || null)}
				>
					<option value="">{props.placeholder}</option>
					<option value="employee-2">Picker option employee-2</option>
				</select>
			</label>
		);
	},
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
		translateMock.mockClear();
		employeeSelectPropsMock.mockClear();
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
		const [input] = getSurchargeCalculationsForPeriodMock.mock.calls[0] ?? [];
		expect(input.startDate).toBeInstanceOf(Date);
		expect(input.endDate).toBeInstanceOf(Date);
		expect(input.employeeId).toBeUndefined();

		expect(screen.getByText("8h 0m")).toBeTruthy();
		expect(screen.getByText("2h 0m")).toBeTruthy();
		expect(screen.getByText("0h 30m")).toBeTruthy();
		expect(screen.getByText("Mina Miller")).toBeTruthy();
		expect(screen.getByText("25%")).toBeTruthy();
	});

	it("renders an empty state when no calculations match", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({
			success: true,
			data: [],
		});

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
		expect(translateMock).toHaveBeenCalledWith(
			"settings.surcharges.reports.details.workPeriod",
			"Work period",
		);
		expect(translateMock).toHaveBeenCalledWith(
			"settings.surcharges.reports.details.calculatedAt",
			"Calculated at",
		);
		expect(translateMock).toHaveBeenCalledWith(
			"settings.surcharges.reports.details.overlapPolicy",
			"Overlap policy",
		);
		expect(translateMock).toHaveBeenCalledWith(
			"settings.surcharges.reports.details.appliedRules",
			"Applied rules",
		);
		expect(translateMock).toHaveBeenCalledWith(
			"settings.surcharges.reports.details.qualifying",
			"Qualifying",
		);
		expect(translateMock).toHaveBeenCalledWith(
			"settings.surcharges.reports.details.surcharge",
			"Surcharge",
		);
		expect(translateMock).toHaveBeenCalledWith(
			"settings.surcharges.reports.details.percentage",
			"Percentage",
		);
	});

	it("translates the no applied rules detail fallback", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({
			success: true,
			data: [
				{
					...calculation,
					calculationDetails: {
						...calculation.calculationDetails,
						rulesApplied: [],
					},
				},
			],
		});

		render(<SurchargeReports organizationId="org-1" />);

		const detailsButton = await screen.findByRole("button", {
			name: "Show details for Mina Miller",
		});
		fireEvent.click(detailsButton);

		expect(screen.getByText("No applied rules recorded.")).toBeTruthy();
		expect(translateMock).toHaveBeenCalledWith(
			"settings.surcharges.reports.details.noAppliedRules",
			"No applied rules recorded.",
		);
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
			.mockResolvedValueOnce({
				success: false,
				error: "Failed to fetch calculations",
			});

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
		getSurchargeCalculationsForPeriodMock.mockResolvedValue({
			success: true,
			data: [],
		});

		render(<SurchargeReports organizationId="org-1" />);

		await screen.findByText("No surcharge calculations found");
		expect(getSurchargeCalculationsForPeriodMock).toHaveBeenCalledTimes(1);
		getSurchargeCalculationsForPeriodMock.mockClear();

		const form = screen.getByTestId("surcharge-report-filters");
		fireEvent.change(within(form).getByLabelText("Employee"), {
			target: { value: "employee-2" },
		});

		await Promise.resolve();
		expect(getSurchargeCalculationsForPeriodMock).toHaveBeenCalledTimes(0);

		fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

		await waitFor(() => {
			expect(getSurchargeCalculationsForPeriodMock).toHaveBeenCalledTimes(1);
		});
		expect(getSurchargeCalculationsForPeriodMock.mock.calls[0]?.[0].employeeId).toBe("employee-2");
	});

	it("filters by a picked employee and offers all employees again", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValue({ success: true, data: [] });

		render(<SurchargeReports organizationId="org-1" />);

		await screen.findByText("No surcharge calculations found");
		const lastProps = () => employeeSelectPropsMock.mock.lastCall?.[0];
		expect(lastProps()).toMatchObject({
			value: null,
			placeholder: "All employees",
			includeFormerEmployees: true,
		});
		expect(screen.queryByRole("button", { name: "Show all employees" })).toBeNull();

		const form = screen.getByTestId("surcharge-report-filters");
		fireEvent.change(within(form).getByLabelText("Employee"), {
			target: { value: "employee-2" },
		});
		expect(lastProps()?.value).toBe("employee-2");

		fireEvent.click(screen.getByRole("button", { name: "Show all employees" }));
		expect(lastProps()?.value).toBeNull();

		getSurchargeCalculationsForPeriodMock.mockClear();
		fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

		await waitFor(() => {
			expect(getSurchargeCalculationsForPeriodMock).toHaveBeenCalledTimes(1);
		});
		expect(getSurchargeCalculationsForPeriodMock.mock.calls[0]?.[0].employeeId).toBeUndefined();
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

	it("does not render previous organization rows during an organization change", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValue({
			success: true,
			data: [calculation],
		});

		const { rerender } = render(<SurchargeReports organizationId="org-1" />);

		expect(await screen.findByText("Mina Miller")).toBeTruthy();

		act(() => {
			rerender(<SurchargeReports organizationId="org-2" />);
		});

		expect(screen.queryByText("Mina Miller")).toBeNull();
		expect(screen.getByText("0 calculations")).toBeTruthy();
	});
});
