/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { useSubmissionNow } from "./use-submission-now";

afterEach(() => {
	vi.useRealTimers();
});

describe("useSubmissionNow", () => {
	it("moves exactly when the earliest future date has happened", () => {
		vi.useFakeTimers();
		// 2026-10-08 starts in Pacific/Kiritimati (UTC+14) at 2026-10-07T10:00Z.
		vi.setSystemTime(new Date("2026-10-07T09:00:00.000Z"));
		const deadlines = {
			dates: ["2026-10-08"],
			instants: [parseInstant("2026-10-07T12:00:00Z")],
		};
		const { result } = renderHook(() => useSubmissionNow(deadlines));

		expect(result.current.toString()).toBe("2026-10-07T09:00:00Z");
		expect(vi.getTimerCount()).toBe(1);
		act(() => vi.advanceTimersByTime(3_600_000 - 1));
		expect(result.current.toString()).toBe("2026-10-07T09:00:00Z");
		act(() => vi.advanceTimersByTime(1));
		expect(result.current.toString()).toBe("2026-10-07T10:00:00Z");
		act(() => vi.advanceTimersByTime(2 * 3_600_000));
		expect(result.current.toString()).toBe("2026-10-07T12:00:00Z");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("keeps no timer while nothing is future-dated", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-07T09:00:00.000Z"));
		renderHook(() => useSubmissionNow({ dates: ["2026-10-07"], instants: [] }));

		expect(vi.getTimerCount()).toBe(0);
	});

	it("waits for a date months ahead without overflowing the timer", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-07T09:00:00.000Z"));
		const { result } = renderHook(() => useSubmissionNow({ dates: ["2027-03-01"], instants: [] }));

		act(() => vi.advanceTimersByTime(1_000));
		expect(result.current.toString()).toBe("2026-10-07T09:00:00Z");
		expect(vi.getTimerCount()).toBe(1);
	});
});
