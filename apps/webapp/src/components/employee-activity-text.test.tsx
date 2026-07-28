/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type EmployeeActivityTemplates,
	formatEmployeeActivity,
} from "./employee-activity-format";
import { EmployeeActivityText } from "./employee-activity-text";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			key: string,
			defaultValue: string,
			params?: Record<string, number | string>,
		) => {
			const translations: Record<string, string> = {
				"common:presence.activity.relativeMinutes": "seit {minutes}min",
			};
			return (translations[key] ?? defaultValue).replace(
				/\{(\w+)\}/g,
				(_match, name: string) => String(params?.[name] ?? ""),
			);
		},
	}),
}));

const templates: EmployeeActivityTemplates = {
	relativeMinutes: (minutes) => `minutes:${minutes}`,
	relativeHours: (hours) => `hours:${hours}`,
	relativeHoursMinutes: (hours, minutes) => `hours-minutes:${hours}:${minutes}`,
	lastActivity: (date) => `date:${date}`,
};

const now = parseInstant("2026-07-28T12:00:00Z");

describe("formatEmployeeActivity", () => {
	it.each([
		[
			"sub-minute activity as zero whole minutes",
			"2026-07-28T11:59:30Z",
			"minutes:0",
		],
		["activity from 40 minutes ago", "2026-07-28T11:20:00Z", "minutes:40"],
		["activity from exactly two hours ago", "2026-07-28T10:00:00Z", "hours:2"],
		[
			"activity from two hours and 15 minutes ago",
			"2026-07-28T09:45:00Z",
			"hours-minutes:2:15",
		],
	])("formats %s relatively", (_description, lastActivityAt, expected) => {
		expect(formatEmployeeActivity(lastActivityAt, 120, templates, now)).toBe(
			expected,
		);
	});

	it("keeps activity older than three hours relative on the same event-local date", () => {
		expect(
			formatEmployeeActivity("2026-07-28T06:30:00Z", 120, templates, now),
		).toBe("hours-minutes:5:30");
	});

	it("uses the event offset to keep different UTC dates relative on the same local date", () => {
		const offsetNow = parseInstant("2026-07-28T01:00:00Z");
		expect(
			formatEmployeeActivity(
				"2026-07-27T18:00:00Z",
				-120,
				templates,
				offsetNow,
			),
		).toBe("hours:7");
	});

	it("keeps activity under three hours relative across event-local midnight", () => {
		const midnightNow = parseInstant("2026-07-28T22:30:00Z");
		expect(
			formatEmployeeActivity(
				"2026-07-28T20:45:00Z",
				120,
				templates,
				midnightNow,
			),
		).toBe("hours-minutes:1:45");
	});

	it("renders the event-local date when it differs from the event UTC date", () => {
		expect(
			formatEmployeeActivity("2026-07-28T00:30:00Z", -120, templates, now),
		).toBe("date:27.07.");
	});

	it("renders a date at the strict 180-minute relative threshold", () => {
		const thresholdNow = parseInstant("2026-07-28T01:00:00Z");
		expect(
			formatEmployeeActivity(
				"2026-07-27T22:00:00Z",
				0,
				templates,
				thresholdNow,
			),
		).toBe("date:27.07.");
	});

	it("renders an older date in the captured event offset", () => {
		const offsetSensitiveNow = parseInstant("2026-07-29T04:30:00Z");
		expect(
			formatEmployeeActivity(
				"2026-07-28T21:30:00Z",
				-180,
				templates,
				offsetSensitiveNow,
			),
		).toBe("date:28.07.");
	});

	it.each([
		["a null timestamp", null, 120],
		["a null offset", "2026-07-28T11:20:00Z", null],
		["a malformed instant", "not-an-instant", 120],
		["an invalid offset", "2026-07-28T11:20:00Z", 1440],
	])("returns null for %s", (_description, lastActivityAt, offset) => {
		expect(
			formatEmployeeActivity(lastActivityAt, offset, templates, now),
		).toBeNull();
	});

	it("returns null for future activity", () => {
		expect(
			formatEmployeeActivity("2026-07-28T12:00:01Z", 120, templates, now),
		).toBeNull();
	});
});

describe("EmployeeActivityText", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders localized activity text with muted styling", () => {
		vi.useFakeTimers();
		vi.setSystemTime("2026-07-28T12:00:00Z");

		render(
			<EmployeeActivityText
				lastActivityAt="2026-07-28T11:20:00Z"
				lastActivityUtcOffsetMinutes={120}
			/>,
		);

		const activity = screen.getByText("seit 40min");
		expect(activity.tagName).toBe("P");
		expect(activity.className).toBe("text-xs text-muted-foreground");
	});

	it("renders nothing when activity metadata is incomplete", () => {
		vi.useFakeTimers();
		vi.setSystemTime("2026-07-28T12:00:00Z");

		const { container } = render(
			<EmployeeActivityText
				lastActivityAt={null}
				lastActivityUtcOffsetMinutes={120}
			/>,
		);

		expect(container.innerHTML).toBe("");
	});
});
