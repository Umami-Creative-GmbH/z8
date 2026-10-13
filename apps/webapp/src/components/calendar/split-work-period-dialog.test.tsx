/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { splitWorkPeriod } from "@/app/[locale]/(app)/time-tracking/actions";
import type { CalendarEvent } from "@/lib/calendar/types";
import { SplitWorkPeriodDialog } from "./split-work-period-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	splitWorkPeriod: vi.fn(),
}));

const event: CalendarEvent = {
	id: "period-1",
	type: "work_period",
	date: new Date("2026-10-25T00:00:00.000Z"),
	endDate: new Date("2026-10-25T03:00:00.000Z"),
	title: "Work period",
	color: "blue",
	metadata: { durationMinutes: 180, employeeName: "Ada Lovelace" },
};

describe("SplitWorkPeriodDialog", () => {
	it("selects the next local date for an overnight period before resolving the split", () => {
		const overnightEvent = {
			...event,
			date: new Date("2026-05-04T20:00:00.000Z"),
			endDate: new Date("2026-05-05T04:00:00.000Z"),
			metadata: { durationMinutes: 480, employeeName: "Ada Lovelace" },
		};
		render(
			<SplitWorkPeriodDialog
				event={overnightEvent}
				open={true}
				onOpenChange={vi.fn()}
				displayContext={{ locale: "en-US", timezone: "Europe/Berlin", timeFormat: "24h" }}
			/>,
		);

		const splitDate = screen.getByLabelText("Split date");
		expect(splitDate).toBeTruthy();
		fireEvent.change(splitDate, { target: { value: "2026-05-05" } });
		fireEvent.change(screen.getByLabelText("Split at"), { target: { value: "02:00" } });

		expect(screen.getByText("Preview")).toBeTruthy();
	});

	it("formats the resolved split instant in the configured 12-hour display context", () => {
		const daytimeEvent = {
			...event,
			date: new Date("2026-05-04T08:00:00.000Z"),
			endDate: new Date("2026-05-04T16:00:00.000Z"),
			metadata: { durationMinutes: 480, employeeName: "Ada Lovelace" },
		};
		render(
			<SplitWorkPeriodDialog
				event={daytimeEvent}
				open={true}
				onOpenChange={vi.fn()}
				displayContext={{ locale: "en-US", timezone: "Europe/Berlin", timeFormat: "12h" }}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Split at"), { target: { value: "13:30" } });

		expect(screen.getAllByText(/1:30\s*PM/)).toHaveLength(2);
	});

	it("shows localized mutually exclusive fold choices only for ambiguous split times", () => {
		render(
			<SplitWorkPeriodDialog
				event={event}
				open={true}
				onOpenChange={vi.fn()}
				displayContext={{ locale: "de-DE", timezone: "Europe/Berlin", timeFormat: "24h" }}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Split at"), { target: { value: "02:30" } });

		expect(screen.getByRole("radiogroup", { name: "Choose occurrence" })).toBeTruthy();
		expect(screen.getAllByRole("radio")).toHaveLength(2);
		fireEvent.click(screen.getByRole("radio", { name: "Later occurrence" }));
		expect(
			screen.getByRole("radio", { name: "Later occurrence" }).getAttribute("aria-checked"),
		).toBe("true");
	});

	it("shows a nonexistent-time message without fold choices for a DST gap", () => {
		const gapEvent = {
			...event,
			date: new Date("2026-03-29T00:00:00.000Z"),
			endDate: new Date("2026-03-29T03:00:00.000Z"),
		};
		render(
			<SplitWorkPeriodDialog
				event={gapEvent}
				open={true}
				onOpenChange={vi.fn()}
				displayContext={{ locale: "de-DE", timezone: "Europe/Berlin", timeFormat: "24h" }}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Split at"), { target: { value: "02:30" } });

		expect(screen.getByText("Split time does not exist on this date")).toBeTruthy();
		expect(screen.queryByRole("radiogroup")).toBeNull();
	});

	it("keeps one split identity across retries and starts a new one after a split", async () => {
		const split = vi.mocked(splitWorkPeriod);
		split.mockReset();
		split
			.mockResolvedValueOnce({ success: false, error: "Work period changed while editing" })
			.mockResolvedValueOnce({
				success: true,
				data: { firstPeriodId: "period-1", secondPeriodId: "period-2" },
			})
			.mockResolvedValueOnce({
				success: true,
				data: { firstPeriodId: "period-1", secondPeriodId: "period-3" },
			});
		const daytimeEvent = {
			...event,
			date: new Date("2026-05-04T08:00:00.000Z"),
			endDate: new Date("2026-05-04T16:00:00.000Z"),
			metadata: { durationMinutes: 480, employeeName: "Ada Lovelace" },
		};
		render(
			<SplitWorkPeriodDialog
				event={daytimeEvent}
				open={true}
				onOpenChange={vi.fn()}
				displayContext={{ locale: "en-US", timezone: "Europe/Berlin", timeFormat: "24h" }}
			/>,
		);
		fireEvent.change(screen.getByLabelText("Split at"), { target: { value: "13:30" } });
		const confirm = screen.getByRole("button", { name: "Split Work Period" });

		for (const calls of [1, 2, 3]) {
			fireEvent.click(confirm);
			await waitFor(() => expect(split).toHaveBeenCalledTimes(calls));
			await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
		}

		const identities = split.mock.calls.map((call) => call[6]);
		expect(identities[0]).toMatch(/^[0-9a-f-]{36}$/);
		// The refused attempt's retry reuses its identity; a completed split does not.
		expect(identities[1]).toBe(identities[0]);
		expect(identities[2]).not.toBe(identities[1]);
		// Work without vehicle use asks nothing about kilometres (#1126).
		expect(screen.queryByLabelText(/Odometer reading at the split/)).toBeNull();
		expect(split.mock.calls.map((call) => call[7])).toEqual([undefined, undefined, undefined]);
	});

	describe("vehicle use (#1126)", () => {
		const van = {
			kind: "organization",
			vehicleId: "0b9f8f2e-6c1d-4d6c-9a43-7f2f3c1f5e10",
		} as const;
		const drivenEvent = (vehicleUse: object): CalendarEvent => ({
			...event,
			date: new Date("2026-05-04T08:00:00.000Z"),
			endDate: new Date("2026-05-04T16:00:00.000Z"),
			metadata: { durationMinutes: 480, employeeName: "Ada Lovelace", vehicleUse },
		});

		async function splitWith(evt: CalendarEvent, label: RegExp, value?: string) {
			const split = vi.mocked(splitWorkPeriod);
			split.mockReset();
			split.mockResolvedValue({
				success: true,
				data: { firstPeriodId: "period-1", secondPeriodId: "period-2" },
			});
			render(
				<SplitWorkPeriodDialog
					event={evt}
					open={true}
					onOpenChange={vi.fn()}
					displayContext={{ locale: "en-US", timezone: "Europe/Berlin", timeFormat: "24h" }}
				/>,
			);
			fireEvent.change(screen.getByLabelText("Split at"), { target: { value: "13:30" } });
			if (value !== undefined) {
				fireEvent.change(screen.getByLabelText(label), { target: { value } });
			}
			fireEvent.click(screen.getByRole("button", { name: "Split Work Period" }));
			await waitFor(() => expect(split).toHaveBeenCalledTimes(1));
			return split.mock.calls[0]?.[7];
		}

		it("asks for the odometer reading at the split when the work has readings", async () => {
			const value = await splitWith(
				drivenEvent({ vehicle: van, startKm: 12_000, endKm: 12_085, distanceKm: 85 }),
				/Odometer reading at the split/,
				"12040",
			);
			expect(value).toBe(12_040);
		});

		it("asks for the first period's kilometres of a directly entered distance", async () => {
			const value = await splitWith(
				drivenEvent({ vehicle: { kind: "own" }, startKm: null, endKm: null, distanceKm: 120 }),
				/Kilometres in the first period/,
				"70",
			);
			expect(value).toBe(70);
		});

		it("sends no value when the reading is skipped", async () => {
			const value = await splitWith(
				drivenEvent({ vehicle: van, startKm: 12_000, endKm: 12_085, distanceKm: 85 }),
				/Odometer reading at the split/,
			);
			expect(value).toBeUndefined();
		});

		it("explains that claimed work can't be split until its expense item is removed", async () => {
			const split = vi.mocked(splitWorkPeriod);
			split.mockReset();
			split.mockResolvedValue({
				success: false,
				error: "The work's distance is on an expense item",
				code: "work_period_distance_claimed",
			});
			const error = vi.mocked(toast.error);
			error.mockClear();
			render(
				<SplitWorkPeriodDialog
					event={drivenEvent({
						vehicle: { kind: "own" },
						startKm: null,
						endKm: null,
						distanceKm: 120,
					})}
					open={true}
					onOpenChange={vi.fn()}
					displayContext={{ locale: "en-US", timezone: "Europe/Berlin", timeFormat: "24h" }}
				/>,
			);
			fireEvent.change(screen.getByLabelText("Split at"), { target: { value: "13:30" } });
			fireEvent.click(screen.getByRole("button", { name: "Split Work Period" }));

			await waitFor(() =>
				expect(error).toHaveBeenCalledWith(
					"This work period's distance is on an expense item. Remove the item from the expense report before splitting the work period.",
				),
			);
		});
	});
});
