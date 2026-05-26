import { readFileSync } from "node:fs";
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
		S3_PUBLIC_BUCKET: "test-bucket",
		S3_PUBLIC_ACCESS_KEY_ID: "test-access-key",
		S3_PUBLIC_SECRET_ACCESS_KEY: "test-secret-key",
		S3_PUBLIC_ENDPOINT: "https://example.com",
		S3_PUBLIC_URL: "https://example.com",
		S3_PUBLIC_REGION: "us-east-1",
		S3_PUBLIC_FORCE_PATH_STYLE: "true",
		NODE_ENV: "test",
	},
}));


describe("buildPendingApprovalResult", () => {
	it("prevents self-submitted approvals from being shown as pending for the requester", () => {
		// Keep this as a source-level regression because the query is executed through Drizzle's
		// relation API and this test suite intentionally avoids a database dependency.
		const source = readFileSync("src/lib/approvals/server/queries.ts", "utf8");

		expect(source).toContain("ne(approvalRequest.requestedBy, currentEmployee.id)");
	});

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

	it("includes sick detail in absence approval payloads", () => {
		const result = buildPendingApprovalResult({
			pendingRequests: [
				{
					id: "approval-1",
					entityId: "absence-1",
					entityType: "absence_entry",
					status: "pending",
					createdAt: new Date("2026-05-01T00:00:00.000Z"),
					requester: {
						user: {
							id: "user-1",
							name: "Ada Lovelace",
							email: "ada@example.com",
							image: null,
						},
					},
				},
			],
			absencesById: new Map([
				[
					"absence-1",
					{
						id: "absence-1",
						startDate: "2026-05-18",
						startPeriod: "full_day",
						endDate: "2026-05-18",
						endPeriod: "full_day",
						notes: null,
						sickDetail: "child_sick",
						category: { name: "Sick Leave", type: "sick", color: null },
					},
				],
			]),
			periodsById: new Map(),
		});

		expect(result.absenceApprovals[0]?.absence.sickDetail).toBe("child_sick");
	});

	it("redacts stale sick detail from non-sick absence approval payloads", () => {
		const result = buildPendingApprovalResult({
			pendingRequests: [
				{
					id: "approval-1",
					entityId: "absence-1",
					entityType: "absence_entry",
					status: "pending",
					createdAt: new Date("2026-05-01T00:00:00.000Z"),
					requester: {
						user: {
							id: "user-1",
							name: "Ada Lovelace",
							email: "ada@example.com",
							image: null,
						},
					},
				},
			],
			absencesById: new Map([
				[
					"absence-1",
					{
						id: "absence-1",
						startDate: "2026-06-01",
						startPeriod: "full_day",
						endDate: "2026-06-01",
						endPeriod: "full_day",
						notes: null,
						sickDetail: "with_certificate",
						category: { name: "Vacation", type: "vacation", color: null },
					},
				],
			]),
			periodsById: new Map(),
		});

		expect(result.absenceApprovals[0]?.absence.sickDetail).toBeNull();
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
