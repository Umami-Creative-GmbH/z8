import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { runningClockOutLabels, runningWorkPeriodTitle } from "./running-work-period-labels";

const t = (_key: string, fallback: string, params?: Record<string, string>) =>
	Object.entries(params ?? {}).reduce(
		(text, [name, value]) => text.replace(`{${name}}`, value),
		fallback,
	);

function runningEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
	return {
		id: "period-1",
		type: "work_period",
		date: new Date("2026-11-19T09:45:00Z"),
		title: "Kai Hentschel - 3m (running)",
		color: "#10b981",
		metadata: { isRunning: true, employeeName: "Kai Hentschel", durationMinutes: 3 },
		...overrides,
	};
}

describe("runningWorkPeriodTitle", () => {
	it("counts the live duration up to the moved end, not the server's read-time snapshot", () => {
		const title = runningWorkPeriodTitle(
			runningEvent({ endDate: new Date("2026-11-19T10:52:30Z") }),
			t,
		);
		expect(title).toBe("Kai Hentschel - 1h 07m (running)");
	});

	it("falls back to the reported minutes before the calendar moves the end", () => {
		expect(runningWorkPeriodTitle(runningEvent(), t)).toBe("Kai Hentschel - 0h 03m (running)");
	});

	it("keeps the project and task prefix", () => {
		const title = runningWorkPeriodTitle(
			runningEvent({
				metadata: {
					isRunning: true,
					employeeName: "Ada Lovelace",
					durationMinutes: 150,
					projectName: "Payroll",
					taskName: "Review",
				},
			}),
			t,
		);
		expect(title).toBe("[Payroll · Review] Ada Lovelace - 2h 30m (running)");
	});
});

describe("runningClockOutLabels", () => {
	it("names whose work the button stops", () => {
		const labels = runningClockOutLabels(t);
		expect(labels.label).toBe("Stop");
		expect(labels.ariaLabel("Kai Hentschel")).toBe("Stop running work period for Kai Hentschel");
	});
});
