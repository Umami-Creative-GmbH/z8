import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ApprovalInboxBulkDecisionResult } from "@/lib/approvals/inbox/types";
import {
	readBulkDecisionResult,
	readQueryError,
	useApprovalInbox,
	type useBulkApprove,
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
