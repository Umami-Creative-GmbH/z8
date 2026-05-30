/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	PersonalWorkdayTimeline,
	type SerializableWorkdayTimelineData,
	type SerializableWorkdayTimelineResult,
} from "./personal-workday-timeline";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

const selectedDate = {
	dateKey: "2026-05-03",
	todayDateKey: "2026-05-03",
	previousDateKey: "2026-05-02",
	nextDateKey: "2026-05-04",
	label: "May 3, 2026",
};

function success(
	data: Partial<SerializableWorkdayTimelineData>,
): SerializableWorkdayTimelineResult {
	return {
		success: true,
		data: {
			selectedDate,
			items: [],
			dayWarnings: [],
			hasScheduledContext: false,
			hasRecordedActivity: false,
			...data,
		},
	};
}

describe("PersonalWorkdayTimeline", () => {
	it("renders warning summary and chronological items", () => {
		render(
			<PersonalWorkdayTimeline
				result={success({
					dayWarnings: [
						{
							id: "warning:pending-edit:1",
							type: "warning",
							title: "Unapproved edit pending",
							subtitle: "A time correction for this day is waiting for approval.",
							severity: "warning",
							link: { label: "Review request", href: "/my-requests" },
						},
					],
					items: [
						{
							id: "shift:1",
							type: "shift",
							title: "Scheduled shift",
							startLabel: "08:00",
							endLabel: "16:00",
						},
					],
				})}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Workday timeline" })).toBeTruthy();
		expect(screen.getByText("Unapproved edit pending")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Review request" }).getAttribute("href")).toBe(
			"/my-requests",
		);
		expect(screen.getByText("08:00 - 16:00")).toBeTruthy();
	});

	it("renders a useful empty state", () => {
		render(<PersonalWorkdayTimeline result={success({})} />);

		expect(screen.getByText("No activity recorded for this day.")).toBeTruthy();
		expect(
			screen.getByText("There are no shifts, absences, or time entries for the selected day yet."),
		).toBeTruthy();
	});

	it("keeps the required empty state when context exists without timeline items", () => {
		render(<PersonalWorkdayTimeline result={success({ hasScheduledContext: true })} />);

		expect(screen.getByText("No activity recorded for this day.")).toBeTruthy();
		expect(
			screen.getByText("There are no shifts, absences, or time entries for the selected day yet."),
		).toBeTruthy();
	});

	it("renders an unavailable alert without throwing", () => {
		render(
			<PersonalWorkdayTimeline
				result={{ success: false, selectedDate, error: "Timeline unavailable" }}
			/>,
		);

		expect(screen.getByText("Timeline unavailable")).toBeTruthy();
		expect(
			screen.getByText("Clocking time still works. Try refreshing this view later."),
		).toBeTruthy();
	});

	it("renders day picker links", () => {
		render(<PersonalWorkdayTimeline result={success({})} />);

		expect(screen.getByRole("link", { name: "Previous day" }).getAttribute("href")).toBe(
			"/time-tracking?date=2026-05-02",
		);
		expect(screen.getByRole("link", { name: "Today" }).getAttribute("href")).toBe(
			"/time-tracking?date=2026-05-03",
		);
		expect(screen.getByRole("link", { name: "Next day" }).getAttribute("href")).toBe(
			"/time-tracking?date=2026-05-04",
		);
	});
});
