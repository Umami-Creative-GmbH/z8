/* @vitest-environment jsdom */
import { cleanup, render as renderWithProvider, screen } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkPeriodEvent } from "@/lib/calendar/types";
import { createTestTolgee, render } from "@/test/render-with-translations";
import deCatalog from "../../../messages/calendar/de.json";

vi.mock("@/stores/organization-settings-store", () => ({
	useProjectsEnabled: () => false,
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
afterEach(cleanup);
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
