/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveWork } from "@/lib/calendar/types";
import { useLiveWorkNow } from "./use-live-work-now";

const liveWork: LiveWork[] = [{ startedAt: new Date("2026-05-04T10:00:00.500Z") }];

afterEach(() => {
	vi.useRealTimers();
});

describe("useLiveWorkNow", () => {
	it("has no instant during server rendering", () => {
		function Probe() {
			return <span>{useLiveWorkNow(liveWork)?.toString() ?? "none"}</span>;
		}

		expect(renderToString(<Probe />)).toBe("<span>none</span>");
	});

	it("moves exactly on each elapsed-minute boundary of the live work", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T10:02:30.000Z"));
		const { result } = renderHook(() => useLiveWorkNow(liveWork));

		expect(result.current?.toString()).toBe("2026-05-04T10:02:00.5Z");
		act(() => vi.advanceTimersByTime(30_499));
		expect(result.current?.toString()).toBe("2026-05-04T10:02:00.5Z");
		act(() => vi.advanceTimersByTime(1));
		expect(result.current?.toString()).toBe("2026-05-04T10:03:00.5Z");
		act(() => vi.advanceTimersByTime(60_000));
		expect(result.current?.toString()).toBe("2026-05-04T10:04:00.5Z");
	});

	it("keeps no timer without live work", () => {
		vi.useFakeTimers();
		const { result } = renderHook(() => useLiveWorkNow([]));

		expect(result.current).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});
});
