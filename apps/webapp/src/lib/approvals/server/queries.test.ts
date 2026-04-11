import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type {
	ApprovalDecisionAction,
	ApprovalType,
	ApprovalStatus,
	BulkDecisionFailure,
	BulkDecisionResult,
	BulkDecisionSuccess,
} from "@/lib/approvals/domain/types";
import { buildPendingApprovalResult } from "@/lib/approvals/server/queries";

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret",
		S3_BUCKET: "test-bucket",
		S3_ACCESS_KEY_ID: "test-access-key",
		S3_SECRET_ACCESS_KEY: "test-secret-key",
		S3_ENDPOINT: "https://example.com",
		S3_PUBLIC_URL: "https://example.com",
		S3_REGION: "us-east-1",
		S3_FORCE_PATH_STYLE: "true",
		NODE_ENV: "test",
	},
}));


describe("buildPendingApprovalResult", () => {
	it("returns absences and time corrections in request order", () => {
		const result = buildPendingApprovalResult({
			pendingRequests: [],
			absencesById: new Map(),
			periodsById: new Map(),
		});

		expect(result).toEqual({
			absenceApprovals: [],
			timeCorrectionApprovals: [],
		});
	});

	it("supports travel expense claims in the richer bulk decision contract", () => {
		const approvalType: ApprovalType = "travel_expense_claim";
		const decisionActions: ApprovalDecisionAction[] = ["approve", "reject"];
		const succeeded: BulkDecisionSuccess = {
			id: "approval-1",
			approvalType,
			status: "approved",
		};
		const failed: BulkDecisionFailure = {
			id: "approval-2",
			code: "unsupported",
			message: "Bulk action is not supported for this approval type.",
		};
		const result: BulkDecisionResult = {
			succeeded: [succeeded],
			failed: [failed],
		};

		expect(decisionActions).toEqual(["approve", "reject"]);
		expect(result).toEqual({
			succeeded: [
				{
					id: "approval-1",
					approvalType: "travel_expense_claim",
					status: "approved",
				},
			],
			failed: [
				{
					id: "approval-2",
					code: "unsupported",
					message: "Bulk action is not supported for this approval type.",
				},
			],
		});

		expectTypeOf<BulkDecisionSuccess["approvalType"]>().toEqualTypeOf<ApprovalType>();
		expectTypeOf<BulkDecisionSuccess["status"]>().toEqualTypeOf<ApprovalStatus>();
		expectTypeOf<BulkDecisionFailure["code"]>().toEqualTypeOf<
			"forbidden" | "stale" | "validation_failed" | "not_found" | "unsupported"
		>();
	});
});
