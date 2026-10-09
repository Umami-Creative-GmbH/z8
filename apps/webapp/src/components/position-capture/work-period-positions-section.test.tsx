// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	PositionStampViewerAccessData,
	WorkPeriodPositionStampData,
} from "@/app/[locale]/(app)/calendar/position-stamps-actions";
import { WorkPeriodPositionsSection } from "./work-period-positions-section";

const { accessMock, showMock } = vi.hoisted(() => ({
	accessMock: vi.fn(),
	showMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) => {
			let translated = fallback;
			for (const [key, value] of Object.entries(params ?? {})) {
				translated = translated.replace(`{${key}}`, String(value));
			}
			return translated;
		},
	}),
}));
vi.mock("@/app/[locale]/(app)/calendar/position-stamps-actions", () => ({
	getPositionStampViewerAccessAction: accessMock,
	showWorkPeriodPositionsAction: showMock,
}));

const PERIOD = "d8310000-0000-4000-8000-0000000000f1";
const EMPLOYEE = "d8310000-0000-4000-8000-000000000006";

const clockIn: WorkPeriodPositionStampData = {
	event: "clock_in",
	latitude: 52.520008,
	longitude: 13.404954,
	accuracyMeters: 18.5,
	fixedAt: "2026-09-20T06:00:00Z",
	eventAt: "2026-09-20T06:00:00Z",
	eventUtcOffsetMinutes: 120,
	originalEvent: false,
};
const correctedClockOut: WorkPeriodPositionStampData = {
	event: "clock_out",
	latitude: 52.51,
	longitude: 13.39,
	accuracyMeters: 34.2,
	fixedAt: "2026-09-20T14:00:00Z",
	eventAt: "2026-09-20T14:00:00Z",
	eventUtcOffsetMinutes: 120,
	originalEvent: true,
};

function access(overrides: Partial<PositionStampViewerAccessData>) {
	return {
		success: true,
		data: { available: true, ownEmployeeId: null, mayViewOthers: false, ...overrides },
	};
}

function renderSection(employeeId: string = EMPLOYEE) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return render(<WorkPeriodPositionsSection workPeriodId={PERIOD} employeeId={employeeId} />, {
		wrapper,
	});
}

describe("WorkPeriodPositionsSection", () => {
	beforeEach(() => {
		accessMock.mockReset();
		showMock.mockReset().mockResolvedValue({
			success: true,
			data: { workPeriodId: PERIOD, stamps: [clockIn, correctedClockOut] },
		});
	});
	afterEach(cleanup);

	it("shows positions only after Show positions, with accuracy and a maps link", async () => {
		accessMock.mockResolvedValue(access({ mayViewOthers: true }));
		renderSection();

		const button = await screen.findByRole("button", { name: "Show positions" });
		expect(screen.queryByText(/52\.52001/)).toBeNull();
		expect(showMock).not.toHaveBeenCalled();

		await userEvent.click(button);

		expect(showMock).toHaveBeenCalledWith({ workPeriodId: PERIOD });
		expect(await screen.findByText("52.52001, 13.40495")).toBeTruthy();
		expect(screen.getByText("within 19 m")).toBeTruthy();
		const links = screen.getAllByRole("link", { name: "Open in maps" });
		expect(links[0]?.getAttribute("href")).toBe(
			"https://www.openstreetmap.org/?mlat=52.520008&mlon=13.404954#map=17/52.520008/13.404954",
		);
		expect(links[0]?.getAttribute("rel")).toContain("noopener");
		expect(
			screen.getByText(
				"Recorded with the original clock-out at 2026-09-20 16:00 (UTC+02:00). The times were corrected later.",
			),
		).toBeTruthy();
		expect(screen.getByText(/the viewing is logged/i)).toBeTruthy();
	});

	it("offers the employee their own positions without the logging hint", async () => {
		accessMock.mockResolvedValue(access({ ownEmployeeId: EMPLOYEE }));
		renderSection();

		await userEvent.click(await screen.findByRole("button", { name: "Show positions" }));
		await screen.findByText("52.52001, 13.40495");
		expect(screen.queryByText(/the viewing is logged/i)).toBeNull();
	});

	it("offers nothing to a manager without the permission", async () => {
		accessMock.mockResolvedValue(access({ ownEmployeeId: "someone-else" }));
		renderSection();

		await waitFor(() => expect(accessMock).toHaveBeenCalled());
		expect(screen.queryByRole("button", { name: "Show positions" })).toBeNull();
	});

	it("offers nothing when the organization never published a position notice", async () => {
		accessMock.mockResolvedValue(access({ available: false, mayViewOthers: true }));
		renderSection();

		await waitFor(() => expect(accessMock).toHaveBeenCalled());
		expect(screen.queryByRole("button", { name: "Show positions" })).toBeNull();
	});

	it("translates a refusal by its code and never shows the server's text", async () => {
		accessMock.mockResolvedValue(access({ mayViewOthers: true }));
		showMock.mockResolvedValue({
			success: false,
			error: "diagnostic text from the server",
			code: "positions_forbidden",
		});
		renderSection();

		await userEvent.click(await screen.findByRole("button", { name: "Show positions" }));
		expect(
			await screen.findByText("You are not allowed to see the positions of this work period."),
		).toBeTruthy();
		expect(screen.queryByText("diagnostic text from the server")).toBeNull();
	});

	it("says when no position was recorded", async () => {
		accessMock.mockResolvedValue(access({ mayViewOthers: true }));
		showMock.mockResolvedValue({ success: true, data: { workPeriodId: PERIOD, stamps: [] } });
		renderSection();

		await userEvent.click(await screen.findByRole("button", { name: "Show positions" }));
		expect(
			await screen.findByText("No positions were recorded for this work period."),
		).toBeTruthy();
	});
});
