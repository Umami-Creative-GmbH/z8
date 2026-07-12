/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { SplitWorkPeriodDialog } from "./split-work-period-dialog";

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
});
