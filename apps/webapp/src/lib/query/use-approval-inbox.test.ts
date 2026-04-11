import { describe, expect, expectTypeOf, it } from "vitest";
import type { BulkDecisionResult } from "@/lib/approvals/domain/types";
import {
	readBulkDecisionResult,
	readQueryError,
	type useBulkApprove,
} from "./use-approval-inbox";

describe("useApprovalInbox contracts", () => {
	it("returns the richer bulk decision result from bulk approve mutations", () => {
		type BulkApproveMutationResult = Awaited<
			ReturnType<ReturnType<typeof useBulkApprove>["mutateAsync"]>
		>;

		expectTypeOf<BulkApproveMutationResult>().toEqualTypeOf<BulkDecisionResult>();
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
