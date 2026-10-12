/* @vitest-environment jsdom */
import { cleanup, render as renderWithProvider, screen } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { AbsenceEvent, WorkPeriodEvent } from "@/lib/calendar/types";
import { createTestTolgee, render } from "@/test/render-with-translations";
import deCatalog from "../../../messages/calendar/de.json";

const settings = vi.hoisted(() => ({ projectsEnabled: false }));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/stores/organization-settings-store", () => ({
	useProjectsEnabled: () => settings.projectsEnabled,
}));

import { EventDetailsPanel } from "./event-details-panel";

const event: WorkPeriodEvent = {
	id: "period-1",
	type: "work_period",
	date: new Date("2026-05-04T06:00:00Z"),
	endDate: new Date("2026-05-04T18:00:00Z"),
	title: "Ada - 12h",
	color: "#10b981",
	metadata: {
		durationMinutes: 720,
		employeeId: "employee-1",
		employeeName: "Ada",
		clockOutUtcOffsetMinutes: 120,
		clockOutTimezone: "Europe/Berlin",
		automaticClockOut: {
			cutoffAt: "2026-05-04T18:00:00Z",
			limitMinutes: 720,
			processedAt: "2026-05-04T18:03:00Z",
		},
	},
};
afterEach(() => {
	cleanup();
	settings.projectsEnabled = false;
});
describe("automatic clock-out details", () => {
	it("renders the German automatic-source catalog", () => {
		const translations = Object.fromEntries(
			Object.entries(deCatalog.calendar.details).map(([key, value]) => [
				`calendar.details.${key}`,
				value,
			]),
		);
		renderWithProvider(
			<TolgeeProvider tolgee={createTestTolgee("de", translations)}>
				<EventDetailsPanel event={event} onClose={() => {}} />
			</TolgeeProvider>,
		);
		expect(screen.getByText("Automatisch ausgestempelt")).toBeTruthy();
		expect(screen.getByText("Limit für ununterbrochene Arbeit")).toBeTruthy();
		expect(screen.getByText("System")).toBeTruthy();
	});
	it("labels automatic execution as System and displays limit/captured cutoff", () => {
		render(<EventDetailsPanel event={event} onClose={() => {}} />);
		expect(screen.getByText("Automatically clocked out")).toBeTruthy();
		expect(screen.getByText("System")).toBeTruthy();
		expect(screen.getAllByText("12h")).toHaveLength(2);
		expect(screen.getByText(/2026-05-04 20:00.*UTC\+02:00/)).toBeTruthy();
	});
	it("keeps human correction attribution without labeling its new endpoint automatic", () => {
		render(
			<EventDetailsPanel
				event={{
					...event,
					metadata: {
						...event.metadata,
						automaticClockOut: undefined,
						editedByName: "Grace Manager",
						editedAt: new Date("2026-05-05T10:00:00Z"),
					},
				}}
				onClose={() => {}}
			/>,
		);
		expect(screen.queryByText("Automatically clocked out")).toBeNull();
		expect(screen.getByText("Grace Manager")).toBeTruthy();
	});
});

describe("project and task details (#874)", () => {
	const booked: WorkPeriodEvent = {
		...event,
		metadata: {
			...event.metadata,
			automaticClockOut: undefined,
			projectId: "project-1",
			projectName: "Website",
			taskId: "task-1",
			taskName: "Design",
			taskState: "open",
		},
	};

	it("shows the booking's task next to its project", () => {
		settings.projectsEnabled = true;
		render(<EventDetailsPanel event={booked} onClose={() => {}} />);

		expect(screen.getByText("Website")).toBeTruthy();
		expect(screen.getByText("Task")).toBeTruthy();
		expect(screen.getByText("Design")).toBeTruthy();
	});

	it("marks a task that is done by now", () => {
		settings.projectsEnabled = true;
		render(
			<EventDetailsPanel
				event={{ ...booked, metadata: { ...booked.metadata, taskState: "done" } }}
				onClose={() => {}}
			/>,
		);

		expect(screen.getByText("Design (done)")).toBeTruthy();
	});

	it("shows no task row for work without a task", () => {
		settings.projectsEnabled = true;
		render(
			<EventDetailsPanel
				event={{
					...booked,
					metadata: { ...booked.metadata, taskId: undefined, taskName: undefined },
				}}
				onClose={() => {}}
			/>,
		);

		expect(screen.getByText("Website")).toBeTruthy();
		expect(screen.queryByText("Task")).toBeNull();
	});
});

describe("absence details", () => {
	const absence: AbsenceEvent = {
		id: "absence-1",
		type: "absence",
		date: new Date("2026-05-04T00:00:00Z"),
		endDate: new Date("2026-05-06T00:00:00Z"),
		title: "Ada - Vacation",
		color: "#fbbf24",
		metadata: { categoryName: "Vacation", status: "pending", employeeName: "Ada" },
	};
	const withDeputy = (canOpenProfile: boolean): AbsenceEvent => ({
		...absence,
		metadata: {
			...absence.metadata,
			deputy: { id: "employee-9", name: "Grace Hopper", canOpenProfile },
		},
	});

	it("names the deputy, linked when the viewer may open their profile (#1012)", () => {
		render(<EventDetailsPanel event={withDeputy(true)} onClose={() => {}} />);

		expect(screen.getByText("Deputy")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Grace Hopper" }).getAttribute("href")).toBe(
			"/settings/employees/employee-9",
		);
		expect(screen.getByText("Pending")).toBeTruthy();
	});

	it("shows the deputy's name as text when the viewer may not open their profile", () => {
		render(<EventDetailsPanel event={withDeputy(false)} onClose={() => {}} />);

		expect(screen.getByText("Grace Hopper")).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Grace Hopper" })).toBeNull();
	});

	it("shows nothing about a deputy for an absence without one", () => {
		render(<EventDetailsPanel event={absence} onClose={() => {}} />);

		expect(screen.queryByText("Deputy")).toBeNull();
	});
});