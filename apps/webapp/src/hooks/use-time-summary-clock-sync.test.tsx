/* @vitest-environment jsdom */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { TimeClockState } from "@/lib/query/use-time-clock";
import {
	buildTimeKpiBasis,
	summarizeTimeKpis,
} from "@/lib/time-tracking/time-kpis";
import { useTimeSummaryClockSync } from "./use-time-summary-clock-sync";

const refresh = vi.fn();
let active: TimeClockState["activeWorkPeriod"] = null;
const status = { isPending: false, isError: false, isOffline: false };
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/query/use-time-clock", () => ({
	useTimeClock: () => ({ ...status, activeWorkPeriod: active }),
}));

function summary(start?: string) {
	const basis = buildTimeKpiBasis({
		periods: start ? [{ startTime: new Date(start), endTime: null, surchargeMinutes: null }] : [],
		timezone: "Europe/Berlin",
		weekStartDay: "monday",
		requiredMinutesByDate: {},
		limits: null,
	});
	return {
		basis,
		kpis: summarizeTimeKpis(basis, parseInstant("2026-11-14T12:00:00Z")),
	};
}

beforeEach(() => {
	refresh.mockClear();
	active = null;
	status.isPending = false;
	status.isError = false;
	status.isOffline = false;
});

describe("server time summary reconciliation", () => {
	it("refreshes stale totals for clock-in, break, resume and clock-out without manual refresh", () => {
		const stopped = summary();
		const firstStart = "2026-11-14T09:00:00Z";
		const secondStart = "2026-11-14T10:00:00Z";
		const { result, rerender } = renderHook(
			(data) => useTimeSummaryClockSync(data),
			{ initialProps: stopped },
		);
		expect(result.current).toBe(true);
		active = { id: "first", startTime: new Date(firstStart) };
		rerender(stopped);
		expect(result.current).toBe(false);
		expect(refresh).toHaveBeenCalledTimes(1);
		rerender(stopped);
		expect(refresh).toHaveBeenCalledTimes(1);
		rerender(summary(firstStart));
		expect(result.current).toBe(true);
		active = { ...active, breakStartedAt: new Date("2026-11-14T09:30:00Z") };
		rerender(summary(firstStart));
		expect(result.current).toBe(true);
		expect(refresh).toHaveBeenCalledTimes(1);
		active = { id: "resumed", startTime: new Date(secondStart) };
		rerender(stopped);
		expect(result.current).toBe(false);
		expect(refresh).toHaveBeenCalledTimes(2);
		rerender(summary(secondStart));
		expect(result.current).toBe(true);
		active = null;
		rerender(summary(secondStart));
		expect(result.current).toBe(false);
		expect(refresh).toHaveBeenCalledTimes(3);
		rerender(stopped);
		expect(result.current).toBe(true);
	});

	it("does not refresh until clock status is confirmed online, and retries once it recovers", () => {
		active = { id: "active", startTime: new Date("2026-11-14T09:00:00Z") };
		status.isPending = true;
		const { rerender } = renderHook((data) => useTimeSummaryClockSync(data), {
			initialProps: summary(),
		});
		expect(refresh).not.toHaveBeenCalled();
		status.isPending = false;
		status.isOffline = true;
		rerender(summary());
		expect(refresh).not.toHaveBeenCalled();
		status.isOffline = false;
		status.isError = true;
		rerender(summary());
		expect(refresh).not.toHaveBeenCalled();
		status.isError = false;
		rerender(summary());
		expect(refresh).toHaveBeenCalledOnce();
	});
});
