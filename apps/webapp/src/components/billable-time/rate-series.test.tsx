/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query/keys";
import { BillableRateSeries } from "./billable-rate-series";
import { CostRateSeries } from "./cost-rate-series";

const actions = vi.hoisted(() => ({
	billableHistory: vi.fn(),
	costHistory: vi.fn(),
	setBillable: vi.fn(),
	setCost: vi.fn(),
	endBillable: vi.fn(),
	endCost: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/billable-time/rates/actions", () => ({
	getBillableRateHistory: actions.billableHistory,
	setBillableRate: actions.setBillable,
	endBillableRate: actions.endBillable,
}));
vi.mock(
	"@/app/[locale]/(app)/settings/billable-time/cost-rates/actions",
	() => ({
		getCostRateHistory: actions.costHistory,
		setCostRate: actions.setCost,
		endCostRate: actions.endCost,
	}),
);
vi.mock("sonner", () => ({
	toast: { error: actions.error, success: actions.success },
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) =>
				String(params?.[name] ?? match),
			),
	}),
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en-US",
		timezone: "UTC",
		hour12: false,
	}),
}));
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		value,
		onChange,
	}: {
		value?: string;
		onChange: (value: string) => void;
	}) => (
		<input
			aria-label="date"
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));

const employeeId = "94000000-0000-4000-8000-000000000001";
const target = { level: "employee", employeeId } as const;
const periods = [
	{
		id: "old",
		effectiveFrom: "2025-01-01",
		effectiveTo: null,
		hourlyRate: "80.00",
	},
];
const updatedPeriods = [{ ...periods[0], hourlyRate: "95.00" }];
const clients: QueryClient[] = [];

beforeEach(() => {
	vi.resetAllMocks();
	actions.billableHistory.mockResolvedValue({
		success: true,
		data: { currency: "EUR", periods },
	});
	actions.costHistory.mockResolvedValue({
		success: true,
		data: { currency: "EUR", periods, suggestedWage: { hourlyRate: "25.00" } },
	});
});
afterEach(() => {
	cleanup();
	for (const client of clients) client.clear();
	clients.length = 0;
});
const variants = [
	{
		kind: "billable",
		key: queryKeys.billableTime.rateHistory("employee", employeeId, null, null),
		history: actions.billableHistory,
		set: actions.setBillable,
		end: actions.endBillable,
		saved: "Billable rate saved",
		unchanged: "That rate already applies",
	},
	{
		kind: "cost",
		key: queryKeys.billableTime.costRateHistory(employeeId),
		history: actions.costHistory,
		set: actions.setCost,
		end: actions.endCost,
		saved: "Cost rate saved",
		unchanged: "That cost rate already applies",
	},
] as const;

function renderSeries(kind: "billable" | "cost") {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	const onChanged = vi.fn();
	render(
		<QueryClientProvider client={client}>
			{kind === "billable" ? (
				<BillableRateSeries
					target={target}
					title="Billable rate"
					onChanged={onChanged}
				/>
			) : (
				<CostRateSeries
					employeeId={employeeId}
					title="Cost rate"
					onChanged={onChanged}
				/>
			)}
		</QueryClientProvider>,
	);
	return { client, onChanged };
}

describe.each(variants)("$kind rate series", (variant) => {
	it("saves a change and updates only its own cached periods, preserving history metadata", async () => {
		variant.set.mockResolvedValue({
			success: true,
			data: { changed: true, periods: updatedPeriods },
		});
		const user = userEvent.setup();
		const { client, onChanged } = renderSeries(variant.kind);
		const otherKey =
			variant.kind === "billable" ? variants[1].key : variants[0].key;
		client.setQueryData(otherKey, { currency: "CHF", periods: [] });
		await user.click(await screen.findByRole("button", { name: "Set rate" }));
		await user.type(screen.getByPlaceholderText("80.00"), "95");
		await user.click(screen.getByRole("button", { name: "Save rate" }));

		expect(await screen.findByText("€95.00/h")).toBeTruthy();
		expect(actions.success).toHaveBeenCalledWith(variant.saved);
		expect(onChanged).toHaveBeenCalledOnce();
		expect(client.getQueryData(variant.key)).toEqual({
			currency: "EUR",
			periods: updatedPeriods,
			...(variant.kind === "cost"
				? { suggestedWage: { hourlyRate: "25.00" } }
				: {}),
		});
		expect(client.getQueryData(otherKey)).toEqual({
			currency: "CHF",
			periods: [],
		});
	});
});

describe.each(variants)("$kind rate series outcomes", (variant) => {
	it("closes a no-op save without notifying the overview", async () => {
		variant.set.mockResolvedValue({
			success: true,
			data: { changed: false, periods },
		});
		const user = userEvent.setup();
		const { onChanged } = renderSeries(variant.kind);
		await user.click(await screen.findByRole("button", { name: "Set rate" }));
		await user.type(screen.getByPlaceholderText("80.00"), "80");
		await user.click(screen.getByRole("button", { name: "Save rate" }));
		await screen.findByRole("button", { name: "Set rate" });
		expect(actions.success).toHaveBeenCalledWith(variant.unchanged);
		expect(onChanged).not.toHaveBeenCalled();
	});

	it.each(["refused", "rejected"])(
		"retains the form and cache when a save is %s",
		async (failure) => {
			if (failure === "refused")
				variant.set.mockResolvedValue({ success: false, error: "Not allowed" });
			else variant.set.mockRejectedValue(new Error("Network unavailable"));
			const user = userEvent.setup();
			const { client, onChanged } = renderSeries(variant.kind);
			await user.click(await screen.findByRole("button", { name: "Set rate" }));
			await user.type(screen.getByPlaceholderText("80.00"), "95");
			const before = client.getQueryData(variant.key);
			await user.click(screen.getByRole("button", { name: "Save rate" }));
			await waitFor(() =>
				expect(actions.error).toHaveBeenCalledWith(
					failure === "refused"
						? "Not allowed"
						: "An unexpected error occurred",
				),
			);
			expect(screen.getByPlaceholderText("80.00")).toHaveProperty(
				"value",
				"95",
			);
			expect(client.getQueryData(variant.key)).toEqual(before);
			expect(actions.success).not.toHaveBeenCalled();
			expect(onChanged).not.toHaveBeenCalled();
		},
	);

	it("ends the selected series and displays the returned history", async () => {
		const ended = [{ ...periods[0], effectiveTo: "2026-04-01" }];
		variant.end.mockResolvedValue({
			success: true,
			data: { changed: true, periods: ended },
		});
		const user = userEvent.setup();
		const { onChanged } = renderSeries(variant.kind);
		await user.click(await screen.findByRole("button", { name: "End rate" }));
		await user.clear(screen.getByLabelText("date"));
		await user.type(screen.getByLabelText("date"), "2026-04-01");
		await user.click(screen.getByRole("button", { name: "End rate" }));
		expect(await screen.findByText("Jan 1, 2025 to Mar 31, 2026")).toBeTruthy();
		expect(variant.end).toHaveBeenCalledWith({
			...(variant.kind === "billable" ? { target } : { employeeId }),
			effectiveFrom: "2026-04-01",
		});
		expect(onChanged).toHaveBeenCalledOnce();
	});

	it("shows a failed history read as an alert without offering editing", async () => {
		variant.history.mockResolvedValue({
			success: false,
			error: "Rates unavailable",
		});
		renderSeries(variant.kind);
		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			"Rates unavailable",
		);
		expect(screen.queryByRole("button", { name: "Set rate" })).toBeNull();
	});
});

it("offers the cost wage as an explicit starting value and retains it after a save", async () => {
	actions.setCost.mockResolvedValue({
		success: true,
		data: { changed: true, periods: updatedPeriods },
	});
	const user = userEvent.setup();
	renderSeries("cost");
	await user.click(await screen.findByRole("button", { name: "Set rate" }));
	expect(screen.getByPlaceholderText("80.00")).toHaveProperty("value", "");
	await user.click(
		screen.getByRole("button", { name: "Start from the wage of €25.00" }),
	);
	expect(screen.getByPlaceholderText("80.00")).toHaveProperty("value", "25.00");
	await user.click(screen.getByRole("button", { name: "Save rate" }));
	await user.click(await screen.findByRole("button", { name: "Set rate" }));
	expect(
		screen.getByRole("button", { name: "Start from the wage of €25.00" }),
	).toBeTruthy();
	expect(actions.setCost).toHaveBeenCalledWith(
		expect.objectContaining({ employeeId, rate: "25.00" }),
	);
	expect(actions.setBillable).not.toHaveBeenCalled();
});
