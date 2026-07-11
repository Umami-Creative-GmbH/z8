/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJobStatus, useJobStatuses } from "./use-job-status";

function wrapper({ children }: { children: React.ReactNode }) {
	return (
		<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
	);
}

describe("useJobStatus", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("invokes only onError with a bounded message for a failed BullMQ job", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ state: "failed", progress: 100, error: "processor failed" }), {
				status: 200,
			}),
		);
		const onSuccess = vi.fn();
		const onError = vi.fn();

		renderHook(() => useJobStatus("job-failed", { refreshInterval: 0, onSuccess, onError }), {
			wrapper,
		});

		await waitFor(() => expect(onError).toHaveBeenCalledWith("Job failed"));
		expect(onSuccess).not.toHaveBeenCalled();
	});

	it("uses a bounded message for a legacy completed semantic failure", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					state: "completed",
					progress: 100,
					result: { success: false, error: "legacy failure" },
				}),
				{ status: 200 },
			),
		);
		const onSuccess = vi.fn();
		const onError = vi.fn();

		renderHook(
			() => useJobStatus("job-legacy-failure", { refreshInterval: 0, onSuccess, onError }),
			{ wrapper },
		);

		await waitFor(() => expect(onError).toHaveBeenCalledWith("Job failed"));
		expect(onSuccess).not.toHaveBeenCalled();
	});

	it("uses a bounded fallback for a legacy completed failure without an error", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					state: "completed",
					progress: 100,
					result: { success: false },
				}),
				{ status: 200 },
			),
		);
		const onError = vi.fn();

		renderHook(() => useJobStatus("job-legacy-fallback", { refreshInterval: 0, onError }), {
			wrapper,
		});

		await waitFor(() => expect(onError).toHaveBeenCalledWith("Job failed"));
	});

	it("uses a bounded fallback for a failed job without an error", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ state: "failed", progress: 100 }), { status: 200 }),
		);
		const onError = vi.fn();

		renderHook(() => useJobStatus("job-failed-fallback", { refreshInterval: 0, onError }), {
			wrapper,
		});

		await waitFor(() => expect(onError).toHaveBeenCalledWith("Job failed"));
	});

	it("invokes an error callback only once across terminal revalidation", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
			async () =>
				new Response(
					JSON.stringify({
						state: "failed",
						progress: 100,
						error: "sensitive infrastructure detail",
					}),
					{ status: 200 },
				),
		);
		const onError = vi.fn();
		const { result } = renderHook(
			() => useJobStatus("job-failed-once", { refreshInterval: 0, onError }),
			{ wrapper },
		);

		await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
		await act(async () => {
			await result.current.mutate();
			await result.current.mutate();
		});

		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith("Job failed");
	});

	it("invokes a success callback only once across terminal revalidation", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(
				async () =>
					new Response(
						JSON.stringify({ state: "completed", progress: 100, result: { success: true } }),
						{ status: 200 },
					),
			);
		const onSuccess = vi.fn();
		const { result } = renderHook(
			() => useJobStatus("job-completed-once", { refreshInterval: 0, onSuccess }),
			{ wrapper },
		);

		await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
		await act(async () => {
			await result.current.mutate();
			await result.current.mutate();
		});

		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(onSuccess).toHaveBeenCalledTimes(1);
	});

	it("resets terminal notification cardinality when the job ID changes", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async () =>
				new Response(
					JSON.stringify({ state: "completed", progress: 100, result: { success: true } }),
					{ status: 200 },
				),
		);
		const onSuccess = vi.fn();
		const { rerender } = renderHook(
			({ jobId }) => useJobStatus(jobId, { refreshInterval: 0, onSuccess }),
			{ initialProps: { jobId: "job-one" }, wrapper },
		);

		await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
		rerender({ jobId: "job-two" });
		await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2));
	});

	it.each([
		"completed",
		"failed",
	] as const)("stops polling after BullMQ reports a %s state", async (state) => {
		vi.useFakeTimers();
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(JSON.stringify({ state, progress: 100 }), { status: 200 }));

		const { result } = renderHook(() => useJobStatus(`job-${state}`, { refreshInterval: 100 }), {
			wrapper,
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.status?.state).toBe(state);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_100);
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("continues polling while BullMQ reports a non-terminal state", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(
				async () =>
					new Response(JSON.stringify({ state: "active", progress: 50 }), { status: 200 }),
			);

		const { result } = renderHook(() => useJobStatus("job-active", { refreshInterval: 100 }), {
			wrapper,
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current.status?.state).toBe("active");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_100);
		});
		expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
	});
});

describe("useJobStatuses", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("keeps successful statuses when another job status request fails", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);

			if (url.includes("/api/jobs/job-complete/status")) {
				return new Response(JSON.stringify({ state: "completed", progress: 100 }), { status: 200 });
			}

			return new Response("temporary failure", { status: 500 });
		});

		const { result } = renderHook(
			() => useJobStatuses(["job-complete", "job-transient-error"], { refreshInterval: 0 }),
			{ wrapper },
		);

		await waitFor(() =>
			expect(result.current.statuses.get("job-complete")?.state).toBe("completed"),
		);

		expect(result.current.completedCount).toBe(1);
		expect(result.current.failedCount).toBe(0);
		expect(result.current.pendingCount).toBe(1);
		expect(result.current.statuses.has("job-transient-error")).toBe(false);
	});

	it("counts a legacy completed semantic failure as failed", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			const body = url.includes("job-success")
				? { state: "completed", progress: 100, result: { success: true } }
				: {
						state: "completed",
						progress: 100,
						result: { success: false, error: "legacy failure" },
					};

			return new Response(JSON.stringify(body), { status: 200 });
		});

		const { result } = renderHook(
			() => useJobStatuses(["job-success", "job-legacy-failure"], { refreshInterval: 0 }),
			{ wrapper },
		);

		await waitFor(() => expect(result.current.pendingCount).toBe(0));

		expect(result.current.completedCount).toBe(1);
		expect(result.current.failedCount).toBe(1);
	});
});
