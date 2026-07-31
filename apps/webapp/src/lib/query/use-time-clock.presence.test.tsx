/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { useElapsedTimer, useTimeClock } from "./use-time-clock";

function wrapper(client: QueryClient) {
	return function TestWrapper({ children }: { children: React.ReactNode }) {
		return (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("useElapsedTimer", () => {
	it("uses a stable zero snapshot during server rendering", () => {
		function Timer() {
			return <span>{useElapsedTimer(new Date("2026-07-14T10:00:00Z"))}</span>;
		}

		expect(renderToString(<Timer />)).toBe("<span>0</span>");
	});

	it("updates from the current instant once per second in the browser", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-14T10:00:05Z"));
		const { result } = renderHook(() =>
			useElapsedTimer(new Date("2026-07-14T10:00:00Z")),
		);

		expect(result.current).toBe(5);
		act(() => vi.advanceTimersByTime(1000));
		expect(result.current).toBe(6);
	});
});

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
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const invalidateSpy = vi.spyOn(client, "invalidateQueries");
		mocks.clockIn.mockResolvedValue({ success: true });

		const { result } = renderHook(() => useTimeClock(), {
			wrapper: wrapper(client),
		});
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));
		await result.current.clockIn({ browserTimezone: "America/New_York" });

		expect(mocks.clockIn).toHaveBeenCalledWith(undefined, {
			browserTimezone: "America/New_York",
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: queryKeys.employeeClockStatuses.all,
			});
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: queryKeys.workPolicies.presence.status("emp-1"),
			});
		});
	});

	it("invalidates employee clock statuses after clock out", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const invalidateSpy = vi.spyOn(client, "invalidateQueries");
		mocks.clockOut.mockResolvedValue({ success: true });

		const { result } = renderHook(() => useTimeClock(), {
			wrapper: wrapper(client),
		});
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));
		await result.current.clockOut({ browserTimezone: "America/New_York" });

		expect(mocks.clockOut).toHaveBeenCalledWith(
			undefined,
			undefined,
			expect.objectContaining({
				browserTimezone: "America/New_York",
				submissionId: expect.any(String),
			}),
		);

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: queryKeys.employeeClockStatuses.all,
			});
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: queryKeys.workPolicies.presence.status("emp-1"),
			});
		});
	});

	it("scopes submission ids to deliberate clock-outs and reuses each id across transport retries", async () => {
		const firstSubmissionId = "10000000-0000-4000-8000-000000000099";
		const secondSubmissionId = "20000000-0000-4000-8000-000000000099";
		const randomUUID = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce(firstSubmissionId)
			.mockReturnValueOnce(secondSubmissionId);
		const client = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: 1, retryDelay: 0 },
			},
		});
		mocks.clockOut
			.mockRejectedValueOnce(new Error("connection reset"))
			.mockResolvedValueOnce({ success: true })
			.mockResolvedValueOnce({ success: true });

		const { result } = renderHook(() => useTimeClock(), {
			wrapper: wrapper(client),
		});
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));
		await result.current.clockOut({ browserTimezone: "America/New_York" });
		await result.current.clockOut({ browserTimezone: "America/New_York" });

		expect(randomUUID).toHaveBeenCalledTimes(2);
		expect(mocks.clockOut.mock.calls.map((call) => call[2])).toEqual([
			{
				browserTimezone: "America/New_York",
				submissionId: firstSubmissionId,
			},
			{
				browserTimezone: "America/New_York",
				submissionId: firstSubmissionId,
			},
			{
				browserTimezone: "America/New_York",
				submissionId: secondSubmissionId,
			},
		]);
		randomUUID.mockRestore();
	});

	it("preserves explicit null browser timezone for clock in", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		mocks.clockIn.mockResolvedValue({ success: true });

		const { result } = renderHook(() => useTimeClock(), {
			wrapper: wrapper(client),
		});
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));
		await result.current.clockIn({ browserTimezone: null });

		expect(mocks.clockIn).toHaveBeenCalledWith(undefined, {
			browserTimezone: null,
		});
		expect(mocks.getBrowserTimezone).not.toHaveBeenCalled();
	});

	it("preserves explicit null browser timezone for clock out", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		mocks.clockOut.mockResolvedValue({ success: true });

		const { result } = renderHook(() => useTimeClock(), {
			wrapper: wrapper(client),
		});
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));
		await result.current.clockOut({ browserTimezone: null });

		expect(mocks.clockOut).toHaveBeenCalledWith(
			undefined,
			undefined,
			expect.objectContaining({
				browserTimezone: null,
				submissionId: expect.any(String),
			}),
		);
		expect(mocks.getBrowserTimezone).not.toHaveBeenCalled();
	});

	it("invalidates time clock status, employee clock statuses, and break status after adding a break", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const invalidateSpy = vi.spyOn(client, "invalidateQueries");
		mocks.addBreakToActiveSession.mockResolvedValue({ success: true });

		const { result } = renderHook(() => useTimeClock(), {
			wrapper: wrapper(client),
		});
		await result.current.addBreak({ breakMinutes: 30 });

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: queryKeys.timeClock.status(),
			});
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: queryKeys.employeeClockStatuses.all,
			});
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: queryKeys.timeClock.breakStatus(),
			});
		});
	});

	it("stores browser timezone at click time when queuing offline clock-in", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const queueClockEvent = vi.fn(async () => ({
			success: true,
			eventId: "queued-1",
		}));
		mocks.useOfflineClock.mockReturnValue({
			isOnline: false,
			isOffline: true,
			pendingCount: 0,
			isSyncing: false,
			queueClockEvent,
		});

		const { result } = renderHook(() => useTimeClock(), {
			wrapper: wrapper(client),
		});
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
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const queueClockEvent = vi.fn(async () => ({
			success: true,
			eventId: "queued-1",
		}));
		mocks.useOfflineClock.mockReturnValue({
			isOnline: false,
			isOffline: true,
			pendingCount: 0,
			isSyncing: false,
			queueClockEvent,
		});

		const { result } = renderHook(() => useTimeClock(), {
			wrapper: wrapper(client),
		});
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
