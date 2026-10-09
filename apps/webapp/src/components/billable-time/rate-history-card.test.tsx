/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Temporal } from "temporal-polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateHistoryCard } from "./rate-history-card";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			params
				? fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
				: fallback,
	}),
}));

const display = vi.hoisted(() => ({ locale: "en-US" }));

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: display.locale, timezone: "UTC", hour12: false }),
}));

vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({ value, onChange }: { value?: string; onChange: (value: string) => void }) => (
		<input
			aria-label="date"
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));

const today = Temporal.Now.plainDateISO("UTC");

const periods = [
	{
		id: "b",
		effectiveFrom: today.subtract({ days: 10 }).toString(),
		effectiveTo: null,
		hourlyRate: "95.00",
	},
	{
		id: "a",
		effectiveFrom: "2025-01-01",
		effectiveTo: "2025-07-01",
		hourlyRate: "80.00",
	},
];

function renderCard(overrides: Partial<Parameters<typeof RateHistoryCard>[0]> = {}) {
	const onSetRate = vi.fn().mockResolvedValue(null);
	const onEndRate = vi.fn().mockResolvedValue(null);
	render(
		<RateHistoryCard
			title="Billable rate"
			currency="EUR"
			periods={periods}
			canEdit
			onSetRate={onSetRate}
			onEndRate={onEndRate}
			{...overrides}
		/>,
	);
	return { onSetRate, onEndRate };
}

beforeEach(() => {
	display.locale = "en-US";
});

describe("RateHistoryCard", () => {
	it("marks the rate in effect today and shows each period's last day", () => {
		renderCard();

		expect(screen.getByText("In effect")).toBeTruthy();
		expect(screen.getByText("€95.00/h")).toBeTruthy();
		expect(screen.getByText("Jan 1, 2025 to Jun 30, 2025")).toBeTruthy();
	});

	it("sets a rate from a date, refusing an invalid rate first", async () => {
		const user = userEvent.setup();
		const { onSetRate } = renderCard();

		await user.click(screen.getByRole("button", { name: "Set rate" }));
		const date = screen.getByLabelText("date");
		await user.clear(date);
		await user.type(date, "2025-03-01");
		await user.type(screen.getByPlaceholderText("95.00"), "12.345");
		await user.click(screen.getByRole("button", { name: "Save rate" }));

		expect(
			await screen.findByText("Enter a positive hourly rate with at most two decimals"),
		).toBeTruthy();
		expect(onSetRate).not.toHaveBeenCalled();

		await user.clear(screen.getByPlaceholderText("95.00"));
		await user.type(screen.getByPlaceholderText("95.00"), "99,50");
		await user.click(screen.getByRole("button", { name: "Save rate" }));

		expect(onSetRate).toHaveBeenCalledWith({ effectiveFrom: "2025-03-01", rate: "99,50" });
	});

	it("ends a rate from a date", async () => {
		const user = userEvent.setup();
		const { onEndRate } = renderCard();

		await user.click(screen.getByRole("button", { name: "End rate" }));
		await user.click(screen.getByRole("button", { name: "End rate" }));

		expect(onEndRate).toHaveBeenCalledWith({ effectiveFrom: today.toString() });
	});

	it("offers a suggested starting value without filling it in", async () => {
		const user = userEvent.setup();
		const { onSetRate } = renderCard({
			periods: [],
			suggestion: { rate: "25.00", label: (rate) => `Use the wage of ${rate}` },
		});

		await user.click(screen.getByRole("button", { name: "Set rate" }));
		const rate = screen.getByPlaceholderText("0.00") as HTMLInputElement;
		expect(rate.value).toBe("");

		await user.click(screen.getByRole("button", { name: "Use the wage of €25.00" }));
		expect(rate.value).toBe("25.00");
		await user.clear(rate);
		await user.type(rate, "48");
		await user.click(screen.getByRole("button", { name: "Save rate" }));

		expect(onSetRate).toHaveBeenCalledWith({ effectiveFrom: today.toString(), rate: "48" });
	});

	it("names the rate in effect today, never a current rate", async () => {
		const user = userEvent.setup();
		renderCard();

		await user.click(screen.getByRole("button", { name: "Set rate" }));

		expect(screen.getByText("In effect today: €95.00")).toBeTruthy();
		expect(screen.queryByText(/current rate/i)).toBeNull();
	});

	it("suggests the rate in the viewer's number format", async () => {
		display.locale = "de-DE";
		const user = userEvent.setup();
		renderCard();

		await user.click(screen.getByRole("button", { name: "Set rate" }));

		expect(screen.getByPlaceholderText("95,00")).toBeTruthy();
	});

	it("offers no change form to viewers who cannot edit", () => {
		renderCard({ canEdit: false, periods: [] });

		expect(screen.queryByRole("button", { name: "Set rate" })).toBeNull();
		expect(screen.getByText("No rate set yet")).toBeTruthy();
	});
});
