/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getTimeClockStatus: vi.fn(),
	useOfflineClock: vi.fn(),
	postClockIn: vi.fn(),
	postClockOut: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	addBreakToActiveSession: vi.fn(),
	getTimeClockStatus: mocks.getTimeClockStatus,
	updateTimeEntryNotes: vi.fn(),
}));
vi.mock("@/hooks/use-offline-clock", () => ({ useOfflineClock: mocks.useOfflineClock }));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
	}),
}));
vi.mock("@/lib/time-tracking/time-clock-client", () => ({
	postClockIn: mocks.postClockIn,
	postClockOut: mocks.postClockOut,
}));

import { useTimeClock } from "./use-time-clock";

const PERIOD_ID = "a3bb189e-8bf9-4888-9912-ace4e6543002";
const PROJECT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const context = {
	userId: "user-1",
	organizationId: "org-1",
	employeeId: "5f0c6a52-58a4-4d5c-9b0e-5f7b8c1d2e3f",
	server: window.location.origin,
};

function offlineClock(overrides: Record<string, unknown> = {}) {
	return {
		isOnline: true,
		isOffline: false,
		pendingCount: 0,
		isSyncing: false,
		queueClockEvent: vi.fn(),
		commandCapabilities: { commandVersions: [2], submit: "available", context },
		submitClockCommand: vi.fn(async () => ({ success: true, queued: true, delivery: "pending" })),
		...overrides,
	};
}

function render() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return renderHook(() => useTimeClock(), {
		wrapper: ({ children }: { children: React.ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
}

describe("useTimeClock frozen commands (#279)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getTimeClockStatus.mockResolvedValue({
			hasEmployee: true,
			employeeId: "emp-1",
			isClockedIn: true,
			activeWorkPeriod: { id: PERIOD_ID, startTime: new Date("2026-09-25T06:00:00Z") },
		});
	});

	it("freezes identity, instant, zone and context before handing the command over", async () => {
		const clock = offlineClock();
		mocks.useOfflineClock.mockReturnValue(clock);
		const { result } = render();
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));

		const outcome = await result.current.clockIn({
			workLocationType: "home",
			browserTimezone: "Europe/Berlin",
		});
		expect(outcome).toEqual({ success: true, queued: true, delivery: "pending" });
		expect(mocks.postClockIn).not.toHaveBeenCalled();
		expect(clock.submitClockCommand).toHaveBeenCalledWith({
			operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			kind: "clock_in",
			admission: "delayed",
			occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
			timezone: "Europe/Berlin",
			context,
			workLocationType: "home",
		});
	});

	it("binds a clock-out to the period the page knows, with explicit attribution intent", async () => {
		const clock = offlineClock();
		mocks.useOfflineClock.mockReturnValue(clock);
		const { result } = render();
		await waitFor(() => expect(result.current.activeWorkPeriod?.id).toBe(PERIOD_ID));

		await result.current.clockOut({ projectId: PROJECT_ID, browserTimezone: "Europe/Berlin" });
		expect(clock.submitClockCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "clock_out",
				knownWorkPeriodId: PERIOD_ID,
				project: { kind: "replace", id: PROJECT_ID },
				workCategory: { kind: "preserve" },
			}),
		);
		expect(mocks.postClockOut).not.toHaveBeenCalled();
	});

	it("offers queued offline capture only while freezing is available", async () => {
		mocks.useOfflineClock.mockReturnValue(offlineClock({ isOnline: false, isOffline: true }));
		expect(render().result.current.captureMode).toBe("local-queue");
		mocks.useOfflineClock.mockReturnValue(
			offlineClock({ isOnline: false, isOffline: true, commandCapabilities: null }),
		);
		expect(render().result.current.captureMode).toBe("local-review");
	});

	it.each([
		[
			"fresh submission is not adopted",
			{ commandCapabilities: { commandVersions: [2], submit: "unavailable", context } },
		],
		[
			"capabilities belong to another organization",
			{
				commandCapabilities: {
					commandVersions: [2],
					submit: "available",
					context: { ...context, organizationId: "org-2" },
				},
			},
		],
		["the worker cannot store frozen commands", { commandCapabilities: null }],
	])("keeps the legacy route when %s", async (_name, overrides) => {
		const clock = offlineClock(overrides);
		mocks.useOfflineClock.mockReturnValue(clock);
		mocks.postClockIn.mockResolvedValue({ success: true, data: { id: "entry-1" } });
		const { result } = render();
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));

		await expect(result.current.clockIn({ browserTimezone: "Europe/Berlin" })).resolves.toEqual({
			success: true,
			data: { id: "entry-1" },
		});
		expect(clock.submitClockCommand).not.toHaveBeenCalled();
	});
});
