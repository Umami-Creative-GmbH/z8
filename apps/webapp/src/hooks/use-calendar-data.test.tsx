/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { superJsonResponse } from "@/lib/superjson";
import { useCalendarData } from "./use-calendar-data";

function calendarResponse(liveWork: { startedAt: Date }[]) {
	return superJsonResponse({
		events: [],
		total: 0,
		dailyRequirements: {},
		dailyActualMinutes: {},
		liveWork,
		workBalance: null,
		calendarTimezone: "Europe/Berlin",
	});
}

function renderCalendarData() {
	// The app's provider turns focus refetching off by default.
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
	});
	function Wrapper({ children }: { children: React.ReactNode }) {
		return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	}

	return renderHook(
		() =>
			useCalendarData({
				organizationId: "org-1",
				month: 4,
				year: 2026,
				filters: {
					showHolidays: true,
					showAbsences: true,
					showTimeEntries: false,
					showWorkPeriods: true,
					employeeId: "employee-1",
				},
			}),
		{ wrapper: Wrapper },
	);
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("useCalendarData live work", () => {
	it("returns the employee's live work and checks for changes every minute while it runs", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const startedAt = new Date("2026-05-04T08:00:00.000Z");
		const fetchMock = vi.fn(async () => calendarResponse([{ startedAt }]));
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderCalendarData();

		await waitFor(() => expect(result.current.liveWork).toEqual([{ startedAt }]));
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await act(() => vi.advanceTimersByTimeAsync(60_000));

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("polls quietly but still reports a deliberate refresh as fetching", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const startedAt = new Date("2026-05-04T08:00:00.000Z");
		let releaseFetch: (() => void) | null = null;
		const fetchMock = vi.fn(async () => {
			if (fetchMock.mock.calls.length > 1) {
				await new Promise<void>((resolve) => {
					releaseFetch = resolve;
				});
			}
			return calendarResponse([{ startedAt }]);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderCalendarData();
		await waitFor(() => expect(result.current.liveWork).toHaveLength(1));

		await act(() => vi.advanceTimersByTimeAsync(60_000));
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.current.isFetching).toBe(false);
		await act(async () => releaseFetch?.());

		act(() => result.current.refetch());
		await waitFor(() => expect(result.current.isFetching).toBe(true));
		await act(async () => releaseFetch?.());
		await waitFor(() => expect(result.current.isFetching).toBe(false));
	});

	it("does not poll without live work", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const fetchMock = vi.fn(async () => calendarResponse([]));
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderCalendarData();

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		await act(() => vi.advanceTimersByTimeAsync(120_000));

		expect(result.current.liveWork).toEqual([]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("refetches stale calendar data when the window regains focus", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const fetchMock = vi.fn(async () => calendarResponse([]));
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderCalendarData();
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		await act(() => vi.advanceTimersByTimeAsync(31_000));
		await act(async () => {
			window.dispatchEvent(new Event("visibilitychange"));
		});

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
	});
});
