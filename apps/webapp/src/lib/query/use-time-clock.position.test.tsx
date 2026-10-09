/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	answerPositionConsent,
	currentPositionConsentQuestion,
	registerPositionConsentHost,
	subscribePositionConsentQuestion,
} from "@/components/position-capture/position-consent-prompt";

const mocks = vi.hoisted(() => ({
	getTimeClockStatus: vi.fn(),
	addBreakToActiveSession: vi.fn(),
	useOfflineClock: vi.fn(),
	postClockIn: vi.fn(),
	postClockOut: vi.fn(),
	getOwnPositionCapture: vi.fn(),
	takeClockPosition: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	addBreakToActiveSession: mocks.addBreakToActiveSession,
	getTimeClockStatus: mocks.getTimeClockStatus,
	updateTimeEntryNotes: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/position-stamps/actions", () => ({
	getOwnPositionCaptureAction: mocks.getOwnPositionCapture,
}));
vi.mock("@/lib/time-tracking/position-capture/device-position", () => ({
	takeClockPosition: mocks.takeClockPosition,
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

const context = {
	userId: "user-1",
	organizationId: "org-1",
	employeeId: "5f0c6a52-58a4-4d5c-9b0e-5f7b8c1d2e3f",
	server: window.location.origin,
};
const position = {
	latitude: 52.520008,
	longitude: 13.404954,
	accuracyMeters: 18.5,
	fixedAt: "2026-09-25T07:59:58.500Z",
};
const notice = {
	id: "8f0c6a52-58a4-4d5c-9b0e-5f7b8c1d2e30",
	version: 2,
	purposeStatement: "Site attendance",
	retentionDays: 60,
	templateRevision: 1,
	createdAt: "2026-09-01T00:00:00Z",
};

function capture(overrides: Record<string, unknown>) {
	return {
		success: true,
		data: {
			captureOn: true,
			retentionDays: 30,
			notice,
			consent: { kind: "active", noticeVersion: 2, grantedAt: "2026-09-02T00:00:00Z" },
			canWithdraw: true,
			asksForConsent: false,
			...overrides,
		},
	};
}

function offlineClock(overrides: Record<string, unknown> = {}) {
	return {
		isOnline: true,
		isOffline: false,
		pendingCount: 0,
		isSyncing: false,
		queueClockEvent: vi.fn(),
		commandCapabilities: { commandVersions: [2, 3], submit: "available", context },
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

/** A dialog host stand-in that answers the next question it is shown. */
function answerNextQuestion(answer: "agreed" | "declined" | "dismissed") {
	const asked: unknown[] = [];
	const unsubscribe = subscribePositionConsentQuestion(() => {
		const question = currentPositionConsentQuestion();
		if (!question) return;
		asked.push(question);
		queueMicrotask(() => answerPositionConsent(answer));
	});
	return { asked, unsubscribe };
}

describe("useTimeClock position stamps (#826)", () => {
	let unregisterHost: () => void;

	beforeEach(() => {
		vi.clearAllMocks();
		unregisterHost = registerPositionConsentHost();
		mocks.getTimeClockStatus.mockResolvedValue({
			hasEmployee: true,
			employeeId: "emp-1",
			isClockedIn: false,
			activeWorkPeriod: null,
		});
		mocks.takeClockPosition.mockResolvedValue(position);
	});

	afterEach(() => {
		unregisterHost();
	});

	it("freezes the position taken at the event into the command when capture is on and consented", async () => {
		mocks.getOwnPositionCapture.mockResolvedValue(capture({}));
		const clock = offlineClock();
		mocks.useOfflineClock.mockReturnValue(clock);
		const { result } = render();
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));

		await result.current.clockIn({ workLocationType: "home", browserTimezone: "Europe/Berlin" });

		expect(clock.submitClockCommand).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "clock_in", position }),
		);
	});

	it("submits the clock event first and asks for consent after it, for later events only", async () => {
		mocks.getOwnPositionCapture.mockResolvedValue(
			capture({ consent: { kind: "undecided" }, asksForConsent: true }),
		);
		const order: string[] = [];
		const clock = offlineClock({
			submitClockCommand: vi.fn(async () => {
				order.push("submitted");
				return { success: true, queued: true, delivery: "pending" };
			}),
		});
		mocks.useOfflineClock.mockReturnValue(clock);
		const host = answerNextQuestion("agreed");
		const unsubscribeOrder = subscribePositionConsentQuestion(() => {
			if (currentPositionConsentQuestion()) order.push("asked");
		});
		const { result } = render();
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));

		await result.current.clockIn({ browserTimezone: "Europe/Berlin" });
		await waitFor(() => expect(host.asked).toHaveLength(1));
		host.unsubscribe();
		unsubscribeOrder();

		expect(order).toEqual(["submitted", "asked"]);
		expect(host.asked).toEqual([
			{
				notice: expect.objectContaining({ id: notice.id, version: 2 }),
				retentionDays: 30,
			},
		]);
		// Consent given in the dialog never reaches back to the event it followed.
		expect(mocks.takeClockPosition).not.toHaveBeenCalled();
		expect(clock.submitClockCommand).toHaveBeenCalledWith(
			expect.not.objectContaining({ position: expect.anything() }),
		);
	});

	it("never waits for the consent dialog: clock-in and a break finish while it stays open", async () => {
		mocks.getOwnPositionCapture.mockResolvedValue(
			capture({ consent: { kind: "undecided" }, asksForConsent: true }),
		);
		mocks.useOfflineClock.mockReturnValue(offlineClock({ commandCapabilities: null }));
		mocks.postClockIn.mockResolvedValue({ success: true, data: { id: "entry-1" } });
		mocks.addBreakToActiveSession.mockResolvedValue({ success: true, data: { id: "period-2" } });
		const { result } = render();
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));

		// Nobody answers the dialog.
		await expect(result.current.clockIn({ browserTimezone: "Europe/Berlin" })).resolves.toEqual({
			success: true,
			data: { id: "entry-1" },
		});
		await expect(result.current.addBreak({ breakMinutes: 15 })).resolves.toMatchObject({
			success: true,
		});

		await waitFor(() => expect(currentPositionConsentQuestion()).not.toBeNull());
		answerPositionConsent("dismissed");
		expect(mocks.postClockIn).toHaveBeenCalledWith(
			expect.not.objectContaining({ position: expect.anything() }),
		);
	});

	it("adds at most five seconds for the capture status and the position together", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			// The status arrives late and the device never answers.
			mocks.getOwnPositionCapture.mockImplementation(
				() => new Promise((resolve) => setTimeout(() => resolve(capture({})), 1_400)),
			);
			mocks.takeClockPosition.mockImplementation(() => new Promise(() => {}));
			const clock = offlineClock();
			mocks.useOfflineClock.mockReturnValue(clock);
			const { result } = render();
			await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));

			const clocked = result.current.clockIn({ browserTimezone: "Europe/Berlin" });
			await vi.advanceTimersByTimeAsync(4_800);
			expect(mocks.takeClockPosition).toHaveBeenCalled();
			expect(clock.submitClockCommand).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(300);
			await clocked;
			expect(clock.submitClockCommand).toHaveBeenCalledWith(
				expect.not.objectContaining({ position: expect.anything() }),
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it.each(["declined", "dismissed"] as const)(
		"clocks without a position when the employee answers %s",
		async (answer) => {
			mocks.getOwnPositionCapture.mockResolvedValue(
				capture({ consent: { kind: "undecided" }, asksForConsent: true }),
			);
			const clock = offlineClock();
			mocks.useOfflineClock.mockReturnValue(clock);
			const host = answerNextQuestion(answer);
			const { result } = render();
			await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));

			await result.current.clockIn({ browserTimezone: "Europe/Berlin" });
			host.unsubscribe();

			expect(mocks.takeClockPosition).not.toHaveBeenCalled();
			expect(clock.submitClockCommand).toHaveBeenCalledWith(
				expect.not.objectContaining({ position: expect.anything() }),
			);
		},
	);

	it("takes no position while capture is off", async () => {
		mocks.getOwnPositionCapture.mockResolvedValue(capture({ captureOn: false }));
		const clock = offlineClock();
		mocks.useOfflineClock.mockReturnValue(clock);
		const { result } = render();
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));

		await result.current.clockIn({ browserTimezone: "Europe/Berlin" });

		expect(mocks.takeClockPosition).not.toHaveBeenCalled();
	});

	it("sends the position through the web fallback and with a break", async () => {
		mocks.getOwnPositionCapture.mockResolvedValue(capture({}));
		mocks.useOfflineClock.mockReturnValue(offlineClock({ commandCapabilities: null }));
		mocks.postClockIn.mockResolvedValue({ success: true, data: { id: "entry-1" } });
		mocks.addBreakToActiveSession.mockResolvedValue({ success: true, data: { id: "period-2" } });
		const { result } = render();
		await waitFor(() => expect(result.current.employeeId).toBe("emp-1"));

		await result.current.clockIn({ browserTimezone: "Europe/Berlin" });
		await result.current.addBreak({ breakMinutes: 15 });

		expect(mocks.postClockIn).toHaveBeenCalledWith(expect.objectContaining({ position }));
		expect(mocks.addBreakToActiveSession).toHaveBeenCalledWith(
			15,
			expect.objectContaining({ position }),
		);
	});
});
