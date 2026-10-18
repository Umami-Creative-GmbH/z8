/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClockInOutWidget } from "@/components/time-tracking/clock-in-out-widget";

const mocks = vi.hoisted(() => ({
	clock: {} as Record<string, unknown>,
	toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, string | number>) =>
			Object.entries(values ?? {}).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/hooks/use-compliance-status", () => ({
	useComplianceStatus: () => ({
		alerts: [],
		approvedExceptions: [],
		canClockIn: true,
		checkException: vi.fn(),
		minutesUntilAllowed: null,
		nextAllowedClockIn: null,
		restPeriodEnforcement: "warn",
	}),
}));
vi.mock("@/components/providers/user-preferences-provider", () => ({
	useUserTimezone: () => "Europe/Berlin",
}));
vi.mock("@/lib/time-tracking/timezone-capture", () => ({
	getBrowserTimezone: () => "Europe/Berlin",
}));
vi.mock("@/app/[locale]/(app)/settings/profile/actions", () => ({ updateTimezone: vi.fn() }));
vi.mock("@/components/time-tracking/session-reminder-panel", () => ({
	SessionReminderPanel: () => null,
}));
vi.mock("@/components/compliance/exception-request-dialog", () => ({
	ExceptionRequestDialog: () => null,
}));
vi.mock("@/components/driving-licence/operational-status", () => ({
	DrivingAuthorizationAdvisory: () => null,
}));
// Vehicle use off; clock-vehicle-use.test.tsx covers the vehicle use the clock asks (#1122).
vi.mock("@/components/time-tracking/clock-vehicle-use", async () =>
	(await import("./clock-vehicle-use.test-stub")).vehicleUseOffModule(),
);
vi.mock("@/lib/query", () => ({
	useElapsedTimer: () => 0,
	useTimeClock: () => mocks.clock,
}));

const workStart = new Date("2026-10-10T06:00:00Z");

function clock(overrides: Record<string, unknown> = {}) {
	mocks.clock = {
		isClockedIn: true,
		activeWorkPeriod: { id: "period-1", startTime: workStart },
		captureMode: "server",
		connectionRequired: false,
		isOffline: false,
		isMutating: false,
		isAddingBreak: false,
		isClockingOut: false,
		isStartingBreak: false,
		isResumingBreak: false,
		isUpdatingNotes: false,
		addBreak: vi.fn(),
		clockIn: vi.fn(),
		clockOut: vi.fn().mockResolvedValue({ success: true, data: {} }),
		startBreak: vi.fn().mockResolvedValue({ success: true, data: {} }),
		resumeBreak: vi.fn().mockResolvedValue({ success: true, data: {} }),
		updateNotes: vi.fn(),
		...overrides,
	};
	return mocks.clock as Record<string, ReturnType<typeof vi.fn>>;
}

function renderWidget() {
	return render(
		<ClockInOutWidget
			activeWorkPeriod={{ id: "period-1", startTime: workStart, endTime: null }}
			employeeName="Ada"
			timeFormat="24h"
		/>,
	);
}

describe("ClockInOutWidget break in progress (#888)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
	});

	it("starts a break while working, beside the retrospective quick break", async () => {
		const { startBreak } = clock();
		renderWidget();
		expect(screen.getByRole("button", { name: /Add break/ })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Start break" }));

		await waitFor(() => expect(startBreak).toHaveBeenCalledOnce());
		expect(mocks.toast.success).toHaveBeenCalledWith("Break started", expect.anything());
	});

	it("offers Resume and End day while on break, and no other break", async () => {
		const { resumeBreak, clockOut } = clock({
			activeWorkPeriod: {
				id: "period-1",
				startTime: workStart,
				breakStartedAt: new Date("2026-10-10T09:45:00Z"),
				breakStartedZone: "UTC",
			},
		});
		renderWidget();

		expect(screen.getByText("On break since 09:45")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Add break/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "Start break" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Clock Out" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Resume" }));
		await waitFor(() => expect(resumeBreak).toHaveBeenCalledOnce());

		fireEvent.click(screen.getByRole("button", { name: "End day" }));
		await waitFor(() => expect(clockOut).toHaveBeenCalledOnce());
	});

	it("explains that breaks need a connection while offline", () => {
		clock({ isOffline: true });
		renderWidget();

		expect(
			(screen.getByRole("button", { name: "Start break" }) as HTMLButtonElement).disabled,
		).toBe(true);
		expect(screen.getByText("Starting or resuming a break needs a connection.")).toBeTruthy();
	});

	it("words a refusal that needs saved clock actions to be sent first", async () => {
		clock({
			startBreak: vi.fn().mockResolvedValue({ success: false, code: "pending_clock_actions" }),
		});
		renderWidget();

		fireEvent.click(screen.getByRole("button", { name: "Start break" }));

		await waitFor(() =>
			expect(mocks.toast.error).toHaveBeenCalledWith(
				"Saved clock actions are still being sent. Try again once they are synced.",
			),
		);
	});
});
