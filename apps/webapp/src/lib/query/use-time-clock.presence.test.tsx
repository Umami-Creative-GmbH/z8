/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	clockIn: vi.fn(),
	clockOut: vi.fn(),
	addBreakToActiveSession: vi.fn(),
	getTimeClockStatus: vi.fn(),
	updateTimeEntryNotes: vi.fn(),
	useOfflineClock: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	clockIn: mocks.clockIn,
	clockOut: mocks.clockOut,
	addBreakToActiveSession: mocks.addBreakToActiveSession,
	getTimeClockStatus: mocks.getTimeClockStatus,
	updateTimeEntryNotes: mocks.updateTimeEntryNotes,
}));

vi.mock("@/hooks/use-offline-clock", () => ({
	useOfflineClock: mocks.useOfflineClock,
}));

import { queryKeys } from "./keys";
import { useTimeClock } from "./use-time-clock";

function wrapper(client: QueryClient) {
	return function TestWrapper({ children }: { children: React.ReactNode }) {
		return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	};
}

describe("useTimeClock presence invalidation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.useOfflineClock.mockReturnValue({
			isOnline: true,
			isOffline: false,
			pendingCount: 0,
			isSyncing: false,
			queueClockEvent: vi.fn(),
		});
		mocks.getTimeClockStatus.mockResolvedValue({
			hasEmployee: true,
			employeeId: "emp-1",
			isClockedIn: false,
			activeWorkPeriod: null,
		});
	});

	it("invalidates employee clock statuses after clock in", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const invalidateSpy = vi.spyOn(client, "invalidateQueries");
		mocks.clockIn.mockResolvedValue({ success: true });

		const { result } = renderHook(() => useTimeClock(), { wrapper: wrapper(client) });
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));
		await result.current.clockIn({ browserTimezone: "America/New_York" });

		expect(mocks.clockIn).toHaveBeenCalledWith(undefined, {
			browserTimezone: "America/New_York",
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.employeeClockStatuses.all });
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: queryKeys.workPolicies.presence.status("emp-1"),
			});
		});
	});

	it("invalidates employee clock statuses after clock out", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const invalidateSpy = vi.spyOn(client, "invalidateQueries");
		mocks.clockOut.mockResolvedValue({ success: true });

		const { result } = renderHook(() => useTimeClock(), { wrapper: wrapper(client) });
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));
		await result.current.clockOut({ browserTimezone: "America/New_York" });

		expect(mocks.clockOut).toHaveBeenCalledWith(undefined, undefined, {
			browserTimezone: "America/New_York",
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.employeeClockStatuses.all });
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: queryKeys.workPolicies.presence.status("emp-1"),
			});
		});
	});

	it("invalidates time clock status, employee clock statuses, and break status after adding a break", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const invalidateSpy = vi.spyOn(client, "invalidateQueries");
		mocks.addBreakToActiveSession.mockResolvedValue({ success: true });

		const { result } = renderHook(() => useTimeClock(), { wrapper: wrapper(client) });
		await result.current.addBreak({ breakMinutes: 30 });

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.timeClock.status() });
			expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.employeeClockStatuses.all });
			expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.timeClock.breakStatus() });
		});
	});
});
