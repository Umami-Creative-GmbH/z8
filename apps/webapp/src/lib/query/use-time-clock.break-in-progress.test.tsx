/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	startBreakInProgress: vi.fn(),
	resumeBreakInProgress: vi.fn(),
	getTimeClockStatus: vi.fn(),
	useOfflineClock: vi.fn(),
	useSession: vi.fn(),
	queueClockEvent: vi.fn(),
	submitClockCommand: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	addBreakToActiveSession: vi.fn(),
	startBreakInProgress: mocks.startBreakInProgress,
	resumeBreakInProgress: mocks.resumeBreakInProgress,
	getTimeClockStatus: mocks.getTimeClockStatus,
	updateTimeEntryNotes: vi.fn(),
}));
vi.mock("@/hooks/use-offline-clock", () => ({ useOfflineClock: mocks.useOfflineClock }));
vi.mock("@/lib/auth-client", () => ({ useSession: mocks.useSession }));
vi.mock("@/lib/time-tracking/timezone-capture", () => ({
	getBrowserTimezone: () => "Europe/Berlin",
}));
// Position capture is off here; use-time-clock.position.test.tsx covers it (#826).
vi.mock("@/app/[locale]/(app)/settings/position-stamps/actions", () => ({
	getOwnPositionCaptureAction: async () => ({ success: false, error: "off" }),
}));

import { queryKeys } from "./keys";
import { useTimeClock } from "./use-time-clock";

const working = {
	hasEmployee: true,
	employeeId: "emp-1",
	isClockedIn: true,
	activeWorkPeriod: {
		id: "period-1",
		startTime: new Date("2026-07-22T08:00:00Z"),
		breakStartedAt: null,
		breakStartedZone: null,
	},
};
const onBreak = {
	...working,
	activeWorkPeriod: {
		...working.activeWorkPeriod,
		breakStartedAt: new Date("2026-07-22T09:45:00Z"),
		breakStartedZone: "Europe/Berlin",
	},
};
const confirmed = {
	success: true,
	data: { workPeriodId: "period-1", at: "2026-07-22T09:45:00.000Z" },
};

function online(overrides: Record<string, unknown> = {}) {
	mocks.useOfflineClock.mockReturnValue({
		isOnline: true,
		isOffline: false,
		pendingCount: 0,
		isSyncing: false,
		queueClockEvent: mocks.queueClockEvent,
		submitClockCommand: mocks.submitClockCommand,
		...overrides,
	});
}

async function renderClock(status: unknown) {
	mocks.getTimeClockStatus.mockResolvedValue(status);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(client, "invalidateQueries");
	const rendered = renderHook(() => useTimeClock(), {
		wrapper: ({ children }: { children: React.ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
	await waitFor(() => expect(rendered.result.current.employeeId).toBe("emp-1"));
	return { ...rendered, invalidate };
}

function sentIdentities(action: ReturnType<typeof vi.fn>) {
	return action.mock.calls.map(([context]) => context.submissionId as string);
}

beforeEach(() => {
	vi.clearAllMocks();
	online();
	mocks.useSession.mockReturnValue({
		data: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
		isPending: false,
		error: null,
	});
	mocks.startBreakInProgress.mockResolvedValue(confirmed);
	mocks.resumeBreakInProgress.mockResolvedValue(confirmed);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useTimeClock break in progress (#888)", () => {
	it("starts a break on the work the employee sees and refreshes the clock", async () => {
		const { result, invalidate } = await renderClock(working);

		await expect(result.current.startBreak()).resolves.toEqual(confirmed);

		expect(mocks.startBreakInProgress).toHaveBeenCalledWith({
			submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			workPeriodId: "period-1",
			browserTimezone: "Europe/Berlin",
		});
		await waitFor(() => {
			for (const queryKey of [
				queryKeys.timeClock.status(),
				queryKeys.employeeClockStatuses.all,
				queryKeys.calendar.allEvents,
			]) {
				expect(invalidate).toHaveBeenCalledWith({ queryKey });
			}
		});
	});

	it("resumes the break the employee sees, at its recorded start", async () => {
		const { result } = await renderClock(onBreak);

		await expect(result.current.resumeBreak()).resolves.toEqual(confirmed);

		expect(mocks.resumeBreakInProgress).toHaveBeenCalledWith({
			submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			workPeriodId: "period-1",
			breakStart: "2026-07-22T09:45:00.000Z",
			browserTimezone: "Europe/Berlin",
		});
	});

	it("needs a connection: offline it neither sends, saves nor queues a break", async () => {
		online({ isOnline: false, isOffline: true });
		const { result } = await renderClock(working);

		await expect(result.current.startBreak()).resolves.toMatchObject({
			success: false,
			code: "connection_required",
		});
		await expect(result.current.resumeBreak()).resolves.toMatchObject({
			success: false,
			code: "connection_required",
		});
		expect(mocks.startBreakInProgress).not.toHaveBeenCalled();
		expect(mocks.resumeBreakInProgress).not.toHaveBeenCalled();
		expect(mocks.queueClockEvent).not.toHaveBeenCalled();
		expect(mocks.submitClockCommand).not.toHaveBeenCalled();
	});

	it("waits until saved clock actions are sent before acting on the clock", async () => {
		online({ pendingCount: 1 });
		const { result } = await renderClock(working);

		await expect(result.current.startBreak()).resolves.toMatchObject({
			success: false,
			code: "pending_clock_actions",
		});
		expect(mocks.startBreakInProgress).not.toHaveBeenCalled();
	});

	it("sends nothing without live work or without a break", async () => {
		const notWorking = { ...working, isClockedIn: false, activeWorkPeriod: null };
		const { result } = await renderClock(notWorking);
		await expect(result.current.startBreak()).resolves.toMatchObject({
			success: false,
			code: "not_clocked_in",
		});
		await expect(result.current.resumeBreak()).resolves.toMatchObject({
			success: false,
			code: "no_break_in_progress",
		});
		expect(mocks.startBreakInProgress).not.toHaveBeenCalled();
		expect(mocks.resumeBreakInProgress).not.toHaveBeenCalled();
	});

	it("serializes clicks sent together into one request", async () => {
		let answer: (value: unknown) => void = () => {};
		mocks.startBreakInProgress.mockReturnValue(
			new Promise((resolve) => {
				answer = resolve;
			}),
		);
		const { result } = await renderClock(working);

		const first = result.current.startBreak();
		const second = result.current.startBreak();
		answer(confirmed);

		await expect(Promise.all([first, second])).resolves.toEqual([confirmed, confirmed]);
		expect(mocks.startBreakInProgress).toHaveBeenCalledTimes(1);
	});

	it("keeps the attempt's identity after an uncertain answer and refreshes the clock", async () => {
		mocks.startBreakInProgress
			.mockRejectedValueOnce(new Error("connection reset"))
			.mockResolvedValueOnce({ success: false, error: "worded", code: "unconfirmed" })
			.mockResolvedValueOnce(confirmed)
			.mockResolvedValueOnce(confirmed);
		const { result, invalidate } = await renderClock(working);

		await expect(result.current.startBreak()).resolves.toMatchObject({
			success: false,
			code: "unconfirmed",
			uncertain: true,
		});
		await waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.timeClock.status() }),
		);
		await expect(result.current.startBreak()).resolves.toMatchObject({
			success: false,
			uncertain: true,
		});
		await expect(result.current.startBreak()).resolves.toEqual(confirmed);
		// A confirmed attempt is done: the next click is a new one.
		await result.current.startBreak();

		const [first, second, third, fourth] = sentIdentities(mocks.startBreakInProgress);
		expect([second, third]).toEqual([first, first]);
		expect(fourth).not.toBe(first);
	});

	it("ends the attempt on a confirmed refusal and refreshes the clock", async () => {
		mocks.resumeBreakInProgress.mockResolvedValue({
			success: false,
			error: "Your break changed on another device.",
			code: "no_break_in_progress",
		});
		const { result, invalidate } = await renderClock(onBreak);

		await expect(result.current.resumeBreak()).resolves.toEqual({
			success: false,
			error: "Your break changed on another device.",
			code: "no_break_in_progress",
		});
		await result.current.resumeBreak();

		const [first, second] = sentIdentities(mocks.resumeBreakInProgress);
		expect(second).not.toBe(first);
		await waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.timeClock.status() }),
		);
	});
});
