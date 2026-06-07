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
	useSession: vi.fn(),
	getBrowserTimezone: vi.fn(),
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

vi.mock("@/lib/auth-client", () => ({
	useSession: mocks.useSession,
}));

vi.mock("@/lib/time-tracking/timezone-capture", () => ({
	getBrowserTimezone: mocks.getBrowserTimezone,
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
		mocks.useSession.mockReturnValue({
			data: { session: { activeOrganizationId: "org-1" } },
			isPending: false,
			error: null,
		});
		mocks.getBrowserTimezone.mockReturnValue("Europe/Berlin");
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

	it("preserves explicit null browser timezone for clock in", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		mocks.clockIn.mockResolvedValue({ success: true });

		const { result } = renderHook(() => useTimeClock(), { wrapper: wrapper(client) });
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));
		await result.current.clockIn({ browserTimezone: null });

		expect(mocks.clockIn).toHaveBeenCalledWith(undefined, {
			browserTimezone: null,
		});
		expect(mocks.getBrowserTimezone).not.toHaveBeenCalled();
	});

	it("preserves explicit null browser timezone for clock out", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		mocks.clockOut.mockResolvedValue({ success: true });

		const { result } = renderHook(() => useTimeClock(), { wrapper: wrapper(client) });
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));
		await result.current.clockOut({ browserTimezone: null });

		expect(mocks.clockOut).toHaveBeenCalledWith(undefined, undefined, {
			browserTimezone: null,
		});
		expect(mocks.getBrowserTimezone).not.toHaveBeenCalled();
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

	it("stores browser timezone at click time when queuing offline clock-in", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const queueClockEvent = vi.fn(async () => ({ success: true, eventId: "queued-1" }));
		mocks.useOfflineClock.mockReturnValue({
			isOnline: false,
			isOffline: true,
			pendingCount: 0,
			isSyncing: false,
			queueClockEvent,
		});

		const { result } = renderHook(() => useTimeClock(), { wrapper: wrapper(client) });
		await result.current.clockIn({ workLocationType: "remote" });

		expect(queueClockEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "clock_in",
				organizationId: "org-1",
				workLocationType: "remote",
				browserTimezone: "Europe/Berlin",
			}),
		);
	});

	it("uses explicit browser timezone when queuing offline clock-out", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const queueClockEvent = vi.fn(async () => ({ success: true, eventId: "queued-1" }));
		mocks.useOfflineClock.mockReturnValue({
			isOnline: false,
			isOffline: true,
			pendingCount: 0,
			isSyncing: false,
			queueClockEvent,
		});

		const { result } = renderHook(() => useTimeClock(), { wrapper: wrapper(client) });
		await result.current.clockOut({ browserTimezone: "America/New_York" });

		expect(queueClockEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "clock_out",
				organizationId: "org-1",
				browserTimezone: "America/New_York",
			}),
		);
	});
});
