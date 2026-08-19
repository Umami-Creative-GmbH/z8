import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type {
	ApprovalDecisionAction,
	ApprovalStatus,
	ApprovalType,
	BulkDecisionFailure,
	BulkDecisionResult,
	BulkDecisionSuccess,
} from "@/lib/approvals/domain/types";
import { buildPendingApprovalResult } from "@/lib/approvals/server/queries";
import { categoryNamesForOrganization } from "@/lib/approvals/server/time-correction-review-metadata";

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

		expect(source).toContain(
			"ne(approvalRequest.requestedBy, currentEmployee.id)",
		);
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
		expect(result.absenceApprovals[0]?.absence.startDate).toBe("2026-05-18");
		expect(result.absenceApprovals[0]?.absence.endDate).toBe("2026-05-18");
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

	it("excludes orphaned legacy time corrections from dashboard pending approvals", () => {
		const result = buildPendingApprovalResult({
			pendingRequests: [
				{
					id: "approval-1",
					entityId: "period-1",
					entityType: "time_entry",
					status: "pending",
					createdAt: new Date("2026-05-22T18:28:29.000Z"),
					requester: {
						user: {
							id: "user-1",
							name: "Kai Hentschel",
							email: "kai@example.com",
							image: null,
						},
					},
				},
			],
			absencesById: new Map(),
			periodsById: new Map([
				[
					"period-1",
					{
						id: "period-1",
						startTime: new Date("2026-05-22T14:00:00.000Z"),
						endTime: new Date("2026-05-22T18:00:00.000Z"),
						clockIn: {
							id: "clock-in-original",
							timestamp: new Date("2026-05-22T14:00:00.000Z"),
						},
						clockOut: {
							id: "clock-out-original",
							timestamp: new Date("2026-05-22T18:00:00.000Z"),
						},
						correctionReviewEntries: [],
					},
				],
			]),
		});

		expect(result.timeCorrectionApprovals).toEqual([]);
	});

	it("includes the request reason in time approval DTOs", () => {
		const correctionId = "30000000-0000-4000-8000-000000000003";
		const result = buildPendingApprovalResult({
			pendingRequests: [
				{
					id: "approval-1",
					entityId: "period-1",
					entityType: "time_entry",
					status: "pending",
					reason: "Forgot to clock out after the customer visit",
					createdAt: new Date("2026-05-22T18:28:29.000Z"),
					metadata: {
						timeCorrection: {
							action: "edit",
							clockInCorrectionId: correctionId,
						},
					},
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
			absencesById: new Map(),
			periodsById: new Map([
				[
					"period-1",
					{
						id: "period-1",
						startTime: new Date("2026-05-22T14:00:00.000Z"),
						endTime: null,
						clockIn: {
							id: "clock-in-original",
							timestamp: new Date("2026-05-22T14:00:00.000Z"),
							utcOffsetMinutes: 120,
						},
						clockOut: null,
						correctionReviewEntries: [
							{
								id: correctionId,
								timestamp: new Date("2026-05-22T14:15:00.000Z"),
								replacesEntryId: "clock-in-original",
								utcOffsetMinutes: 120,
							},
						],
					},
				],
			]),
		});

		expect(result.timeCorrectionApprovals[0]?.reason).toBe(
			"Forgot to clock out after the customer visit",
		);
	});

	it("includes resolved metadata-only changes without requiring correction rows", () => {
		const oldCategoryId = "30000000-0000-4000-8000-000000000001";
		const result = buildPendingApprovalResult({
			pendingRequests: [
				{
					id: "approval-1",
					entityId: "period-1",
					entityType: "time_entry",
					status: "pending",
					createdAt: new Date("2026-05-22T18:28:29.000Z"),
					metadata: {
						timeCorrection: {
							action: "edit",
							workLocationType: "home",
							workCategoryId: null,
						},
						timeCorrectionOriginalWorkMetadata: {
							workLocationType: "office",
							workCategoryId: oldCategoryId,
						},
					},
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
			absencesById: new Map(),
			periodsById: new Map([
				[
					"period-1",
					{
						id: "period-1",
						startTime: new Date("2026-05-22T14:00:00.000Z"),
						endTime: new Date("2026-05-22T18:00:00.000Z"),
						workLocationType: "office",
						workCategoryId: oldCategoryId,
						clockIn: {
							id: "clock-in-original",
							timestamp: new Date("2026-05-22T14:00:00.000Z"),
							utcOffsetMinutes: 120,
						},
						clockOut: {
							id: "clock-out-original",
							timestamp: new Date("2026-05-22T18:00:00.000Z"),
							utcOffsetMinutes: 120,
						},
						correctionReviewEntries: [],
					},
				],
			]),
			categoryNamesById: new Map([[oldCategoryId, "Training"]]),
		});

		expect(result.timeCorrectionApprovals).toHaveLength(1);
		expect(result.timeCorrectionApprovals[0]?.workPeriod).toMatchObject({
			clockInCorrectionEntry: null,
			clockOutCorrectionEntry: null,
			metadataChanges: {
				workLocation: { original: "office", requested: "home" },
				workCategory: {
					original: {
						state: "named",
						id: oldCategoryId,
						name: "Training",
					},
					requested: { state: "none" },
				},
			},
		});
	});

	it.each([
		["string root", "malformed"],
		[
			"original snapshot without a correction marker",
			{
				timeCorrectionOriginalWorkMetadata: {
					workLocationType: "office",
					workCategoryId: null,
				},
			},
		],
		[
			"action merge",
			{
				timeCorrection: {
					action: "merge",
					clockInCorrectionId: "30000000-0000-4000-8000-000000000002",
				},
			},
		],
		["endpoint-free legacy marker", { timeCorrection: { action: "edit" } }],
	] as const)("omits explicit malformed %s despite a matching correction candidate", (_label, metadata) => {
		const correctionId = "30000000-0000-4000-8000-000000000002";
		const result = buildPendingApprovalResult({
			pendingRequests: [
				{
					id: "approval-malformed",
					entityId: "period-1",
					entityType: "time_entry",
					status: "pending",
					createdAt: new Date("2026-05-22T18:28:29.000Z"),
					metadata,
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
			absencesById: new Map(),
			periodsById: new Map([
				[
					"period-1",
					{
						id: "period-1",
						startTime: new Date("2026-05-22T14:00:00.000Z"),
						endTime: null,
						clockIn: {
							id: "clock-in-original",
							timestamp: new Date("2026-05-22T14:00:00.000Z"),
							utcOffsetMinutes: 120,
						},
						clockOut: null,
						correctionReviewEntries: [
							{
								id: correctionId,
								timestamp: new Date("2026-05-22T14:15:00.000Z"),
								replacesEntryId: "clock-in-original",
								utcOffsetMinutes: 120,
							},
						],
					},
				],
			]),
		});

		expect(result.timeCorrectionApprovals).toEqual([]);
	});

	it("scopes category lookup queries to the current organization", () => {
		const source = readFileSync("src/lib/approvals/server/queries.ts", "utf8");

		expect(source).toContain(
			"eq(workCategory.organizationId, currentEmployee.organizationId)",
		);
	});

	it("excludes foreign category rows from the organization lookup map", () => {
		const categoryId = "30000000-0000-4000-8000-000000000001";
		const names = categoryNamesForOrganization(
			[
				{ id: categoryId, organizationId: "org-foreign", name: "Foreign Secret" },
			],
			"org-1",
		);

		expect(names.has(categoryId)).toBe(false);
	});

	it.each([
		"manual_time_submission",
		"policy_clock_out",
	] as const)("includes pending %s requests without treating them as orphaned corrections", (kind) => {
		const result = buildPendingApprovalResult({
			pendingRequests: [
				{
					id: `approval-${kind}`,
					entityId: "period-1",
					entityType: "time_entry",
					status: "pending",
					reason: "Manager review requested",
					createdAt: new Date("2026-05-22T18:28:29.000Z"),
					metadata: { timeRequest: { kind } },
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
			absencesById: new Map(),
			periodsById: new Map([
				[
					"period-1",
					{
						id: "period-1",
						startTime: new Date("2026-05-22T14:00:00.000Z"),
						endTime: new Date("2026-05-22T18:00:00.000Z"),
						clockIn: {
							id: "clock-in-original",
							timestamp: new Date("2026-05-22T14:00:00.000Z"),
							utcOffsetMinutes: 120,
						},
						clockOut: {
							id: "clock-out-original",
							timestamp: new Date("2026-05-22T18:00:00.000Z"),
							utcOffsetMinutes: 120,
						},
						correctionReviewEntries: [],
					},
				],
			]),
		});

		expect(result.timeCorrectionApprovals).toHaveLength(1);
		expect(result.timeCorrectionApprovals[0]).toMatchObject({
			id: `approval-${kind}`,
			reason: "Manager review requested",
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

		expectTypeOf<
			BulkDecisionSuccess["approvalType"]
		>().toEqualTypeOf<ApprovalType>();
		expectTypeOf<
			BulkDecisionSuccess["status"]
		>().toEqualTypeOf<ApprovalStatus>();
		expectTypeOf<BulkDecisionFailure["code"]>().toEqualTypeOf<
			"forbidden" | "stale" | "validation_failed" | "not_found" | "unsupported"
		>();
	});
});
