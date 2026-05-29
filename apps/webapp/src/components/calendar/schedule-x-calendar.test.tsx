import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { WorkPeriodEvent } from "@/lib/calendar/types";
import { filterEventsForScheduleXView, resolveClickableCalendarEvent } from "./schedule-x-calendar";

const COMPONENT_DIR = fileURLToPath(new URL(".", import.meta.url));

const completedWorkPeriod: WorkPeriodEvent = {
	id: "work-completed",
	type: "work_period",
	date: new Date("2026-05-18T08:00:00.000Z"),
	endDate: new Date("2026-05-18T16:00:00.000Z"),
	title: "Completed work period",
	color: "#10b981",
	metadata: {
		durationMinutes: 480,
		employeeName: "Kai Hentschel",
	},
};

const runningWorkPeriod: WorkPeriodEvent = {
	id: "work-running",
	type: "work_period",
	date: new Date("2026-05-18T16:30:00.000Z"),
	title: "Running work period",
	color: "#10b981",
	metadata: {
		durationMinutes: 0,
		employeeName: "Kai Hentschel",
		isRunning: true,
	},
};

describe("filterEventsForScheduleXView", () => {
	it("keeps running work periods in day and week views", () => {
		const events = [completedWorkPeriod, runningWorkPeriod];

		expect(filterEventsForScheduleXView(events, "day")).toEqual(events);
		expect(filterEventsForScheduleXView(events, "week")).toEqual(events);
	});

	it("removes only running work periods from month and year views", () => {
		const events = [completedWorkPeriod, runningWorkPeriod];

		expect(filterEventsForScheduleXView(events, "month")).toEqual([completedWorkPeriod]);
		expect(filterEventsForScheduleXView(events, "year")).toEqual([completedWorkPeriod]);
	});
});

describe("resolveClickableCalendarEvent", () => {
	it("returns null for running work periods", () => {
		const events = [
			{ id: runningWorkPeriod.id, _eventData: runningWorkPeriod },
			{ id: completedWorkPeriod.id, _eventData: completedWorkPeriod },
		];

		expect(resolveClickableCalendarEvent(events, { id: runningWorkPeriod.id })).toBeNull();
	});

	it("returns clicked non-running events", () => {
		const events = [
			{ id: runningWorkPeriod.id, _eventData: runningWorkPeriod },
			{ id: completedWorkPeriod.id, _eventData: completedWorkPeriod },
		];

		expect(resolveClickableCalendarEvent(events, { id: completedWorkPeriod.id })).toBe(
			completedWorkPeriod,
		);
	});
});

describe("calendar timezone source", () => {
	it("uses the user's timezone preference for timed work periods", () => {
		const source = readFileSync(join(COMPONENT_DIR, "schedule-x-calendar.tsx"), "utf8");

		expect(source).toContain("useUserTimezone");
		expect(source).not.toContain("useOrganizationTimezone");
	});
});
