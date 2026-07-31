/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type {
	ApprovalInboxBulkDecisionResult,
	ApprovalInboxDecisionSuccess,
} from "@/lib/approvals/inbox/types";
import {
	type ApprovalDecisionResult,
	readBulkDecisionResult,
	readQueryError,
	useApprovalInbox,
	useApproveApproval,
	type useBulkApprove,
	useRejectApproval,
} from "./use-approval-inbox";

const queryMockState = vi.hoisted(() => ({
	useInfiniteQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useInfiniteQuery: queryMockState.useInfiniteQuery,
	};
});

function mutationWrapper(queryClient: QueryClient) {
	return function MutationWrapper({ children }: { children: ReactNode }) {
		return createElement(
			QueryClientProvider,
			{ client: queryClient },
			children,
		);
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("useApprovalInbox contracts", () => {
	it("keeps previous inbox data while a changed search query loads", () => {
		queryMockState.useInfiniteQuery.mockReturnValue({});

		useApprovalInbox({ status: "pending", search: "avery" });

		expect(queryMockState.useInfiniteQuery).toHaveBeenCalledWith(
			expect.objectContaining({
				placeholderData: expect.any(Function),
			}),
		);
	});

	it("returns the richer bulk decision result from bulk approve mutations", () => {
		type BulkApproveMutationResult = Awaited<
			ReturnType<ReturnType<typeof useBulkApprove>["mutateAsync"]>
		>;

		expectTypeOf<BulkApproveMutationResult>().toEqualTypeOf<ApprovalInboxBulkDecisionResult>();
	});

	it("exports the decision result used by approve and reject mutations", () => {
		type ApproveMutationResult = Awaited<
			ReturnType<ReturnType<typeof useApproveApproval>["mutateAsync"]>
		>;
		type RejectMutationResult = Awaited<
			ReturnType<ReturnType<typeof useRejectApproval>["mutateAsync"]>
		>;

		expectTypeOf<ApproveMutationResult>().toEqualTypeOf<ApprovalDecisionResult>();
		expectTypeOf<RejectMutationResult>().toEqualTypeOf<ApprovalDecisionResult>();
		expectTypeOf<Extract<ApprovalDecisionResult, { success: true }>["result"]>().toEqualTypeOf<
			ApprovalInboxDecisionSuccess
		>();
	});

	it("normalizes a common non-2xx approve route error without invalidating", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: "stale" }), {
				status: 409,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useApproveApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(result.current.mutateAsync("approval-1")).resolves.toEqual({
				success: false,
				error: "stale",
			});
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/approvals/inbox/approval-1/approve",
			{
				method: "POST",
			},
		);
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("normalizes a common non-2xx reject route error without invalidating", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: "Forbidden",
					code: "FORBIDDEN",
					action: "reject",
					subject: "approval",
				}),
				{ status: 403 },
			),
		);
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useRejectApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(
				result.current.mutateAsync({
					approvalId: "approval-2",
					reason: "Outdated",
				}),
			).resolves.toEqual({
				success: false,
				error: "Forbidden",
				code: "FORBIDDEN",
				action: "reject",
				subject: "approval",
			});
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/approvals/inbox/approval-2/reject",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reason: "Outdated" }),
			},
		);
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("preserves a structured non-2xx failure result without invalidating", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({ success: false, error: "stale", code: "STALE" }),
					{
						status: 409,
					},
				),
			),
		);
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useApproveApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(result.current.mutateAsync("approval-1")).resolves.toEqual({
				success: false,
				error: "stale",
				code: "STALE",
			});
		});
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("resolves malformed non-2xx approve responses without invalidating", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("{", { status: 502 })),
		);
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useApproveApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(result.current.mutateAsync("approval-1")).resolves.toEqual({
				success: false,
				error: "Failed to approve",
			});
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("resolves non-json non-2xx responses without invalidating approval queries", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(new Response("gateway exploded", { status: 502 })),
		);
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useRejectApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(
				result.current.mutateAsync({
					approvalId: "approval-2",
					reason: "Outdated",
				}),
			).resolves.toEqual({ success: false, error: "Failed to reject" });
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("resolves approve fetch rejection as a fallback failure", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useApproveApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(result.current.mutateAsync("approval-1")).resolves.toEqual({
				success: false,
				error: "Failed to approve",
			});
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("resolves reject fetch rejection as a fallback failure", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useRejectApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(
				result.current.mutateAsync({ approvalId: "approval-2", reason: "Outdated" }),
			).resolves.toEqual({ success: false, error: "Failed to reject" });
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("resolves approve body read rejection as a fallback failure", async () => {
		const response = new Response(null, { status: 500 });
		vi.spyOn(response, "text").mockRejectedValue(new Error("stream failed"));
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useApproveApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(result.current.mutateAsync("approval-1")).resolves.toEqual({
				success: false,
				error: "Failed to approve",
			});
		});
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("resolves reject body read rejection as a fallback failure", async () => {
		const response = new Response(null, { status: 500 });
		vi.spyOn(response, "text").mockRejectedValue(new Error("stream failed"));
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useRejectApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(
				result.current.mutateAsync({ approvalId: "approval-2", reason: "Outdated" }),
			).resolves.toEqual({ success: false, error: "Failed to reject" });
		});
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("preserves a real 2xx approval success payload and invalidates", async () => {
		const successPayload = {
			success: true,
			result: { id: "approval-1", type: "absence_entry", status: "approved" },
		};
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(successPayload), {
					status: 200,
				}),
			),
		);
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useApproveApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(result.current.mutateAsync("approval-1")).resolves.toEqual(
				successPayload,
			);
		});
		expect(invalidateQueries).toHaveBeenCalledTimes(1);
	});

	it("resolves a rejected result from approve as a fallback without invalidating", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						success: true,
						result: {
							id: "approval-1",
							type: "absence_entry",
							status: "rejected",
						},
					}),
					{ status: 200 },
				),
			),
		);
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useApproveApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(result.current.mutateAsync("approval-1")).resolves.toEqual({
				success: false,
				error: "Failed to approve",
			});
		});
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("resolves an approved result from reject as a fallback without invalidating", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						success: true,
						result: {
							id: "approval-2",
							type: "time_entry",
							status: "approved",
						},
					}),
					{ status: 200 },
				),
			),
		);
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useRejectApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(
				result.current.mutateAsync({ approvalId: "approval-2", reason: "Outdated" }),
			).resolves.toEqual({ success: false, error: "Failed to reject" });
		});
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("preserves a rejected result from reject and invalidates", async () => {
		const successPayload = {
			success: true,
			result: { id: "approval-2", type: "time_entry", status: "rejected" },
		};
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(successPayload), { status: 200 }),
			),
		);
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useRejectApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(
				result.current.mutateAsync({ approvalId: "approval-2", reason: "Outdated" }),
			).resolves.toEqual(successPayload);
		});
		expect(invalidateQueries).toHaveBeenCalledTimes(1);
	});

	it.each([
		["malformed JSON", "{", 200],
		["an empty body", "", 500],
		["null", "null", 200],
		["a non-boolean success", JSON.stringify({ success: "false" }), 200],
		["a null success result", JSON.stringify({ success: true, result: null }), 200],
		[
			"a success result with an invalid id",
			JSON.stringify({
				success: true,
				result: { id: 1, type: "absence_entry", status: "approved" },
			}),
			200,
		],
		[
			"a success result with an invalid type",
			JSON.stringify({
				success: true,
				result: { id: "approval-1", type: "shift_request", status: "approved" },
			}),
			200,
		],
		[
			"a success result with an invalid status",
			JSON.stringify({
				success: true,
				result: { id: "approval-1", type: "absence_entry", status: "pending" },
			}),
			200,
		],
		[
			"a 2xx failure payload",
			JSON.stringify({ success: false, error: "stale" }),
			200,
		],
		[
			"a non-2xx success payload",
			JSON.stringify({
				success: true,
				result: { id: "approval-1", type: "absence_entry", status: "approved" },
			}),
			409,
		],
		["an array", JSON.stringify([{ error: "stale" }]), 409],
		["a route error without an error", JSON.stringify({ code: "FORBIDDEN" }), 403],
		[
			"a route error with the wrong type",
			JSON.stringify({ error: false }),
			409,
		],
	])("resolves %s as a fallback failure", async (_name, body, status) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(body, { status })),
		);
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useApproveApproval(), {
			wrapper: mutationWrapper(queryClient),
		});

		await act(async () => {
			await expect(result.current.mutateAsync("approval-1")).resolves.toEqual({
				success: false,
				error: "Failed to approve",
			});
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data?.success).toBe(false);
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("reads new bulk decision payloads", async () => {
		const response = new Response(
			JSON.stringify({
				succeeded: [{ id: "approval-1", type: "absence_entry", status: "approved" }],
				failed: [],
			}),
			{ status: 200 },
		);

		await expect(readBulkDecisionResult(response, "approve")).resolves.toEqual({
			succeeded: [{ id: "approval-1", type: "absence_entry", status: "approved" }],
			failed: [],
		});
	});

	it("rejects legacy bulk decision success payloads", async () => {
		const response = new Response(
			JSON.stringify({
				succeeded: [{ id: "approval-1", approvalType: "absence", status: "approved" }],
				failed: [],
			}),
			{ status: 200 },
		);

		await expect(readBulkDecisionResult(response, "approve")).rejects.toThrow(
			"Invalid bulk approve response",
		);
	});

	it("rejects bulk decision success payloads with unsupported types", async () => {
		const response = new Response(
			JSON.stringify({
				succeeded: [{ id: "approval-1", type: "shift_request", status: "approved" }],
				failed: [],
			}),
			{ status: 200 },
		);

		await expect(readBulkDecisionResult(response, "approve")).rejects.toThrow(
			"Invalid bulk approve response",
		);
	});

	it("rejects bulk decision failures with unsupported codes", async () => {
		const response = new Response(
			JSON.stringify({
				succeeded: [],
				failed: [{ id: "approval-1", code: "timeout", message: "Timed out" }],
			}),
			{ status: 200 },
		);

		await expect(readBulkDecisionResult(response, "approve")).rejects.toThrow(
			"Invalid bulk approve response",
		);
	});

	it("rejects malformed bulk decision failures", async () => {
		const response = new Response(
			JSON.stringify({
				succeeded: [],
				failed: [{ id: "approval-1", code: "forbidden" }],
			}),
			{ status: 200 },
		);

		await expect(readBulkDecisionResult(response, "approve")).rejects.toThrow(
			"Invalid bulk approve response",
		);
	});

	it("rejects non-array bulk decision collections", async () => {
		const nonArraySucceeded = new Response(JSON.stringify({ succeeded: {}, failed: [] }), {
			status: 200,
		});
		const nonArrayFailed = new Response(JSON.stringify({ succeeded: [], failed: {} }), {
			status: 200,
		});

		await expect(readBulkDecisionResult(nonArraySucceeded, "approve")).rejects.toThrow(
			"Invalid bulk approve response",
		);
		await expect(readBulkDecisionResult(nonArrayFailed, "approve")).rejects.toThrow(
			"Invalid bulk approve response",
		);
	});

	it("surfaces API error payloads", async () => {
		const response = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });

		await expect(readQueryError(response, "Fallback")).rejects.toThrow("Forbidden");
	});

	it("throws when a bulk response is not ok", async () => {
		const response = new Response(JSON.stringify({ error: "Bulk approve failed" }), {
			status: 400,
		});

		await expect(readBulkDecisionResult(response)).rejects.toThrow("Bulk approve failed");
	});

	it("uses reject-specific fallback copy when a bulk reject response has no message", async () => {
		const response = new Response(null, {
			status: 500,
			statusText: "Internal Server Error",
		});

		await expect(readBulkDecisionResult(response, "reject")).rejects.toThrow(
			"Bulk reject request failed",
		);
	});

	it("falls back to the action-specific message for malformed non-json error bodies", async () => {
		const response = new Response("gateway exploded", {
			status: 502,
		});

		await expect(readBulkDecisionResult(response, "approve")).rejects.toThrow(
			"Bulk approve request failed",
		);
	});

	it("preserves the server-provided inbox error message when approval loading fails", async () => {
		const response = new Response(JSON.stringify({ error: "Employee not found" }), {
			status: 404,
		});

		await expect(readQueryError(response, "Failed to fetch approvals")).rejects.toThrow(
			"Employee not found",
		);
	});
});
