/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	buildTimeKpiBasis,
	summarizeTimeKpis,
} from "@/lib/time-tracking/time-kpis";

const state = vi.hoisted(() => ({
	clock: {
		isPending: false,
		isError: false,
		hasEmployee: true,
		isClockedIn: false,
		activeWorkPeriod: null as null | {
			startTime: Date;
			breakStartedAt?: Date;
			breakStartedZone?: string;
		},
		isOffline: false,
		refetchStatus: vi.fn(),
	},
	refresh: vi.fn(),
}));
vi.mock("@/lib/query/use-time-clock", () => ({
	useTimeClock: () => state.clock,
	useElapsedTimer: () => 3600,
}));
vi.mock("@/hooks/use-live-work-now", () => ({ useLiveWorkNow: () => null }));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: state.refresh }),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, value),
				fallback,
			),
	}),
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@/components/time-tracking/break-in-progress-notice", () => ({
	BreakInProgressNotice: ({ zone }: { zone: string }) => (
		<span>Recorded break zone: {zone}</span>
	),
}));

import { PersonalDay } from "./personal-day";

function dayRead(startTime?: Date) {
	const basis = buildTimeKpiBasis({
		periods: startTime
			? [{ startTime, endTime: null, surchargeMinutes: null }]
			: [],
		timezone: "Europe/Berlin",
		weekStartDay: "monday",
		requiredMinutesByDate: { "2026-11-14": 480 },
		limits: null,
	});
	return {
		basis,
		kpis: summarizeTimeKpis(basis, parseInstant("2026-11-14T11:00:00Z")),
	};
}

describe("PersonalDay", () => {
	afterEach(cleanup);
	beforeEach(() => {
		Object.assign(state.clock, {
			isPending: false,
			isError: false,
			hasEmployee: true,
			isClockedIn: false,
			activeWorkPeriod: null,
			isOffline: false,
		});
		vi.clearAllMocks();
	});
	it("keeps unknown totals distinct from zero and exposes the real time-tracking destination", () => {
		render(<PersonalDay timeKpis={null} />);
		expect(
			screen.getByText("Today's total is unavailable. Refresh to try again."),
		).toBeTruthy();
		expect(screen.queryByText("0h 00m")).toBeNull();
		expect(
			screen
				.getByRole("link", { name: "Go to time tracking" })
				.getAttribute("href"),
		).toBe("/time-tracking");
	});
	it("shows the authoritative daily requirement and total", () => {
		render(<PersonalDay timeKpis={dayRead()} />);
		expect(screen.getByText("0h 00m")).toBeTruthy();
		expect(screen.getByText("Today · 8h 00m required")).toBeTruthy();
	});
	it("retains the shared break state and its recorded timezone", () => {
		const startTime = new Date("2026-11-14T10:00:00Z");
		Object.assign(state.clock, {
			isClockedIn: true,
			activeWorkPeriod: {
				startTime,
				breakStartedAt: new Date("2026-11-14T10:50:00Z"),
				breakStartedZone: "America/New_York",
			},
		});
		render(<PersonalDay timeKpis={dayRead(startTime)} />);
		expect(screen.getByText("On break")).toBeTruthy();
		expect(
			screen.getByText("Recorded break zone: America/New_York"),
		).toBeTruthy();
		expect(screen.getByText("Current session")).toBeTruthy();
	});
	it("refreshes totals after another clock surface changes the active session", () => {
		Object.assign(state.clock, {
			isClockedIn: true,
			activeWorkPeriod: { startTime: new Date("2026-11-14T10:00:00Z") },
		});
		render(<PersonalDay timeKpis={dayRead()} />);
		expect(state.refresh).toHaveBeenCalledTimes(1);
		expect(screen.queryByText("0h 00m")).toBeNull();
	});
	it("provides a retry when clock status fails", () => {
		state.clock.isError = true;
		render(<PersonalDay timeKpis={null} />);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(state.clock.refetchStatus).toHaveBeenCalledTimes(1);
	});
});
