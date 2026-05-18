/* @vitest-environment jsdom */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useClockInOutWidget } from "@/components/time-tracking/use-clock-in-out-widget";

const mocks = vi.hoisted(() => ({
	addBreak: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: mocks.toastError,
		success: mocks.toastSuccess,
	},
}));

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

vi.mock("@/lib/query", () => ({
	useElapsedTimer: () => 0,
	useTimeClock: () => ({
		activeWorkPeriod: { id: "period-1", startTime: new Date("2026-05-18T08:00:00Z") },
		addBreak: mocks.addBreak,
		clockIn: vi.fn(),
		clockOut: vi.fn(),
		isAddingBreak: false,
		isClockedIn: true,
		isClockingOut: false,
		isMutating: false,
		isUpdatingNotes: false,
		updateNotes: vi.fn(),
	}),
}));

describe("useClockInOutWidget", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("localStorage", {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
		});
	});

	it("adds a break and shows the success toast", async () => {
		mocks.addBreak.mockResolvedValue({ success: true });

		const { result } = renderHook(() =>
			useClockInOutWidget({
				id: "period-1",
				startTime: new Date("2026-05-18T08:00:00Z"),
				endTime: null,
			}),
		);

		await expect(result.current.handleAddBreak(30)).resolves.toEqual({ success: true });
		expect(mocks.addBreak).toHaveBeenCalledWith({ breakMinutes: 30 });
		expect(mocks.toastSuccess).toHaveBeenCalledWith("Break added", {
			description: "You are still clocked in.",
		});
	});

	it("returns add break failures and shows an error toast", async () => {
		mocks.addBreak.mockResolvedValue({ success: false, error: "Break overlaps another entry" });

		const { result } = renderHook(() =>
			useClockInOutWidget({
				id: "period-1",
				startTime: new Date("2026-05-18T08:00:00Z"),
				endTime: null,
			}),
		);

		await expect(result.current.handleAddBreak(15)).resolves.toEqual({
			success: false,
			error: "Break overlaps another entry",
		});
		expect(mocks.toastError).toHaveBeenCalledWith("Break overlaps another entry");
	});

	it("returns the fallback error message when adding a break fails without a server error", async () => {
		mocks.addBreak.mockResolvedValue({ success: false });

		const { result } = renderHook(() =>
			useClockInOutWidget({
				id: "period-1",
				startTime: new Date("2026-05-18T08:00:00Z"),
				endTime: null,
			}),
		);

		await expect(result.current.handleAddBreak(15)).resolves.toEqual({
			success: false,
			error: "Failed to add break. Please try again.",
		});
		expect(mocks.toastError).toHaveBeenCalledWith("Failed to add break. Please try again.");
	});
});
