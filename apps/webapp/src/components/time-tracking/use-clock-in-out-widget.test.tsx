/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useClockInOutWidget } from "@/components/time-tracking/use-clock-in-out-widget";

const mocks = vi.hoisted(() => ({
	addBreak: vi.fn(),
	clockIn: vi.fn(),
	clockOut: vi.fn(),
	getBrowserTimezone: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
	updateTimezone: vi.fn(),
	userTimezone: "Europe/Berlin",
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

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useUserTimezone: () => mocks.userTimezone,
}));

vi.mock("@/lib/time-tracking/timezone-capture", () => ({
	getBrowserTimezone: mocks.getBrowserTimezone,
}));

vi.mock("@/app/[locale]/(app)/settings/profile/actions", () => ({
	updateTimezone: mocks.updateTimezone,
}));

vi.mock("@/lib/query", () => ({
	useElapsedTimer: () => 0,
	useTimeClock: () => ({
		activeWorkPeriod: { id: "period-1", startTime: new Date("2026-05-18T08:00:00Z") },
		addBreak: mocks.addBreak,
		clockIn: mocks.clockIn,
		clockOut: mocks.clockOut,
		isAddingBreak: false,
		isClockedIn: true,
		isClockingOut: false,
		isMutating: false,
		isUpdatingNotes: false,
		updateNotes: vi.fn(),
	}),
}));

function deferredResult<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});

	return { promise, resolve };
}

describe("useClockInOutWidget", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getBrowserTimezone.mockReturnValue("America/New_York");
		mocks.clockIn.mockResolvedValue({ success: true });
		mocks.clockOut.mockResolvedValue({ success: true, data: {} });
		mocks.updateTimezone.mockResolvedValue({ success: true });
		mocks.userTimezone = "Europe/Berlin";
		vi.stubGlobal("localStorage", {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
		});
	});

	it("opens timezone mismatch before clocking out and submits after continuing once", async () => {
		const { result } = renderHook(() =>
			useClockInOutWidget({
				id: "period-1",
				startTime: new Date("2026-05-18T08:00:00Z"),
				endTime: null,
			}),
		);

		await act(async () => {
			await result.current.handleClockOut();
		});

		await waitFor(() => {
			expect(result.current.timezoneMismatch).toEqual({
				browserTimezone: "America/New_York",
				savedTimezone: "Europe/Berlin",
				action: "clock_out",
			});
		});
		expect(mocks.clockOut).not.toHaveBeenCalled();

		await act(async () => {
			await result.current.handleTimezoneMismatchContinueOnce();
		});

		expect(mocks.updateTimezone).not.toHaveBeenCalled();
		expect(mocks.clockOut).toHaveBeenCalledWith({ browserTimezone: "America/New_York" });
	});

	it("ignores duplicate timezone mismatch continuation while clock submit is pending", async () => {
		const clockOutResult = deferredResult<{ success: true; data: Record<string, never> }>();
		mocks.clockOut.mockReturnValue(clockOutResult.promise);

		const { result } = renderHook(() =>
			useClockInOutWidget({
				id: "period-1",
				startTime: new Date("2026-05-18T08:00:00Z"),
				endTime: null,
			}),
		);

		await act(async () => {
			await result.current.handleClockOut();
		});

		await waitFor(() => expect(result.current.timezoneMismatch).not.toBeNull());

		await act(async () => {
			const firstSubmit = result.current.handleTimezoneMismatchContinueOnce();
			const secondSubmit = result.current.handleTimezoneMismatchContinueOnce();
			expect(mocks.clockOut).toHaveBeenCalledTimes(1);
			clockOutResult.resolve({ success: true, data: {} });
			await Promise.all([firstSubmit, secondSubmit]);
		});
	});

	it("updates timezone before continuing a mismatched clock-in", async () => {
		const { result } = renderHook(() => useClockInOutWidget(null));

		await act(async () => {
			await result.current.handleClockIn();
		});

		await waitFor(() => expect(result.current.timezoneMismatch).not.toBeNull());

		await act(async () => {
			await result.current.handleTimezoneMismatchUpdateAndContinue();
		});

		expect(mocks.updateTimezone).toHaveBeenCalledWith("America/New_York");
		expect(mocks.clockIn).toHaveBeenCalledWith({
			workLocationType: "office",
			browserTimezone: "America/New_York",
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
