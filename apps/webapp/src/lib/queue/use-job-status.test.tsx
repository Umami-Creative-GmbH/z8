/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJobStatus, useJobStatuses } from "./use-job-status";

const scope = vi.hoisted(() => ({ userId: "user-one", organizationId: "org-one" }));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: scope.userId }, session: { activeOrganizationId: scope.organizationId } },
		isPending: false,
	}),
}));

function wrapper({ children }: { children: React.ReactNode }) {
	const [client] = useState(
		() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
	);
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useJobStatus", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		scope.userId = "user-one";
		scope.organizationId = "org-one";
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

	it("shares a request across single and batch observers of the same job", async () => {
		const request = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => Response.json({ state: "active", progress: 25 }));
		const { result } = renderHook(
			() => ({
				single: useJobStatus("shared-job", { refreshInterval: 0 }),
				batch: useJobStatuses(["shared-job"], { refreshInterval: 0 }),
			}),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.batch.statuses.get("shared-job")?.progress).toBe(25));
		expect(result.current.single.status?.progress).toBe(25);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("does not reuse a previous organization's job result after scope changes", async () => {
		const request = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () =>
				Response.json({ state: "active", progress: scope.organizationId === "org-one" ? 25 : 75 }),
			);
		const { result, rerender } = renderHook(
			() => useJobStatus("same-job", { refreshInterval: 0 }),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.status?.progress).toBe(25));
		scope.organizationId = "org-two";
		rerender();
		expect(result.current.status?.progress).not.toBe(25);
		await waitFor(() => expect(result.current.status?.progress).toBe(75));
		expect(request).toHaveBeenCalledTimes(2);
	});

	it.each(["completed", "failed"] as const)(
		"stops polling after BullMQ reports a %s state",
		async (state) => {
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
		},
	);

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
