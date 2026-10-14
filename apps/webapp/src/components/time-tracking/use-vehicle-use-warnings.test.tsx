/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VehicleUseWarning } from "@/lib/time-tracking/vehicle-use/plausibility";
import { useVehicleUseWarnings } from "./use-vehicle-use-warnings";

const warning: VehicleUseWarning = {
	code: "start_below_last_end",
	lastRecordedEndKm: 100,
};
describe("vehicle use advisory checks", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});
	it("debounces by request and uses the latest committed callback", async () => {
		const first = vi.fn<() => Promise<VehicleUseWarning[]>>().mockResolvedValue([]);
		const latest = vi.fn<() => Promise<VehicleUseWarning[]>>().mockResolvedValue([warning]);
		const { result, rerender } = renderHook(
			({ request, check }) => useVehicleUseWarnings(request, check),
			{ initialProps: { request: "van:100", check: first } },
		);
		await act(() => vi.advanceTimersByTimeAsync(200));
		rerender({ request: "van:100", check: latest });
		await act(() => vi.advanceTimersByTimeAsync(200));
		expect(first).not.toHaveBeenCalled();
		expect(latest).toHaveBeenCalledTimes(1);
		expect(result.current).toEqual([warning]);
	});
	it("ignores an obsolete response after the request changes", async () => {
		let finish!: (warnings: VehicleUseWarning[]) => void;
		const check = vi
			.fn<() => Promise<VehicleUseWarning[]>>()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValue([]);
		const { result, rerender } = renderHook(
			({ request }) => useVehicleUseWarnings(request, check),
			{ initialProps: { request: "old" } },
		);
		await act(() => vi.advanceTimersByTimeAsync(400));
		rerender({ request: "new" });
		await act(async () => finish([warning]));
		expect(result.current).toEqual([]);
		await act(() => vi.advanceTimersByTimeAsync(400));
		expect(result.current).toEqual([]);
		expect(check).toHaveBeenCalledTimes(2);
	});
	it("cancels a pending check when unmounted", async () => {
		const check = vi.fn<() => Promise<VehicleUseWarning[]>>().mockResolvedValue([warning]);
		const { unmount } = renderHook(() => useVehicleUseWarnings("van", check));
		unmount();
		await act(() => vi.advanceTimersByTimeAsync(400));
		expect(check).not.toHaveBeenCalled();
	});
	it("treats a rejected check as advice with no warnings", async () => {
		const check = vi
			.fn<() => Promise<VehicleUseWarning[]>>()
			.mockRejectedValue(new Error("offline"));
		const { result } = renderHook(() => useVehicleUseWarnings("van", check));
		await act(() => vi.advanceTimersByTimeAsync(400));
		expect(result.current).toEqual([]);
	});
});
