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
		expect(source).toContain("db.query.timeEntry.findMany({");
		expect(source).toContain(
			"eq(timeEntry.organizationId, currentEmployee.organizationId)",
		);
		expect(source).toContain("inArray(timeEntry.id, originalEntryIds)");
		expect(source).toContain("correctionOriginalEntryIds");
		expect(source).toContain('classification.kind !== "ordinary"');
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

	it("includes metadata-linked inactive corrections in the legacy pending table", () => {
		const correction = {
			id: "correction-1",
			timestamp: new Date("2026-05-22T14:15:00.000Z"),
			utcOffsetMinutes: 120,
			replacesEntryId: "clock-in-original",
			isSuperseded: true,
		};
		const result = buildPendingApprovalResult({
			pendingRequests: [
				{
					id: "approval-1",
					entityId: "period-1",
					entityType: "time_entry",
					status: "pending",
					createdAt: new Date("2026-05-22T18:28:29.000Z"),
					metadata: { timeCorrection: { clockInCorrectionId: correction.id } },
					requester: {
						user: {
							id: "user-1",
							name: "Kai",
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
							utcOffsetMinutes: 120,
						},
						clockOut: null,
						correctionReviewEntries: [correction],
					},
				],
			]),
		});

		expect(
			result.timeCorrectionApprovals[0]?.workPeriod.clockInCorrectionEntry,
		).toEqual({
			timestamp: correction.timestamp,
			utcOffsetMinutes: correction.utcOffsetMinutes,
		});
		expect(result.timeCorrectionApprovals[0]).not.toHaveProperty("metadata");
	});

	it("treats malformed explicit correction metadata as invalid without legacy fallback", () => {
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
							action: "erase",
							clockInCorrectionId: "active-correction",
						},
					},
					requester: {
						user: {
							id: "user-1",
							name: "Kai",
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
						endTime: null,
						clockIn: {
							id: "clock-in-original",
							timestamp: new Date("2026-05-22T14:00:00.000Z"),
							utcOffsetMinutes: 120,
						},
						clockOut: null,
						correctionReviewEntries: [
							{
								id: "active-correction",
								timestamp: new Date("2026-05-22T14:15:00.000Z"),
								utcOffsetMinutes: 120,
								replacesEntryId: "clock-in-original",
								isSuperseded: false,
							},
						],
					},
				],
			]),
		});

		expect(result.timeCorrectionApprovals).toEqual([]);
	});

	it.each([
		"manual_time_submission",
		"policy_clock_out",
	] as const)("keeps %s rows visible without correction entries", (kind) => {
		const result = buildPendingApprovalResult({
			pendingRequests: [
				{
					id: "approval-ordinary",
					entityId: "period-ordinary",
					entityType: "time_entry",
					status: "pending",
					createdAt: new Date("2026-05-22T18:28:29.000Z"),
					metadata: { timeRequest: { kind } },
					requester: {
						user: {
							id: "user-1",
							name: "Kai",
							email: "kai@example.com",
							image: null,
						},
					},
				},
			],
			absencesById: new Map(),
			periodsById: new Map([
				[
					"period-ordinary",
					{
						id: "period-ordinary",
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
		expect(result.timeCorrectionApprovals[0]?.workPeriod).toMatchObject({
			id: "period-ordinary",
			clockInCorrectionEntry: null,
			clockOutCorrectionEntry: null,
		});
		expect(result.timeCorrectionApprovals[0]).not.toHaveProperty("metadata");
	});

	it("keeps a historical manual submission visible despite unrelated correction evidence", () => {
		const result = buildPendingApprovalResult({
			pendingRequests: [
				{
					id: "approval-historical",
					entityId: "period-historical",
					entityType: "time_entry",
					status: "pending",
					createdAt: new Date("2026-05-22T18:28:29.000Z"),
					metadata: null,
					reason: "Manual time entry: Forgot to clock",
					requester: {
						user: {
							id: "user-1",
							name: "Kai",
							email: "kai@example.com",
							image: null,
						},
					},
				},
			],
			absencesById: new Map(),
			periodsById: new Map([
				[
					"period-historical",
					{
						id: "period-historical",
						startTime: new Date("2026-05-22T14:00:00.000Z"),
						endTime: new Date("2026-05-22T18:00:00.000Z"),
						pendingChanges: {
							originalStartTime: "2026-05-22T14:00:00.000Z",
							originalEndTime: "2026-05-22T18:00:00.000Z",
							originalDurationMinutes: 240,
							requestedAt: "2026-05-22T18:01:00.000Z",
							requestedBy: "user-1",
							isManualEntry: true,
							reason: "Forgot to clock",
						},
						clockIn: {
							id: "clock-in-original",
							timestamp: new Date("2026-05-22T14:00:00.000Z"),
							utcOffsetMinutes: 120,
						},
						clockOut: null,
						correctionReviewEntries: [
							{
								id: "unrelated-correction",
								timestamp: new Date("2026-05-22T14:15:00.000Z"),
								utcOffsetMinutes: 120,
								replacesEntryId: "clock-in-original",
								isSuperseded: false,
							},
						],
					},
				],
			]),
		});

		expect(result.timeCorrectionApprovals).toHaveLength(1);
		expect(
			result.timeCorrectionApprovals[0]?.workPeriod.clockInCorrectionEntry,
		).toBeNull();
	});

	it("runtime-allowlists nested requester and time-entry DTO fields", () => {
		const hostileUser = {
			id: "user-1",
			name: "Kai",
			email: "kai@example.com",
			image: null,
			passwordHash: "secret-password-hash",
			twoFactorSecret: "secret-2fa",
			inviteToken: "secret-invite",
			accessToken: "secret-access",
		};
		const result = buildPendingApprovalResult({
			pendingRequests: [
				{
					id: "approval-ordinary",
					entityId: "period-ordinary",
					entityType: "time_entry",
					status: "pending",
					createdAt: new Date("2026-05-22T18:28:29.000Z"),
					metadata: { timeRequest: { kind: "manual_time_submission" } },
					requester: {
						id: "employee-1",
						organizationId: "org-1",
						user: hostileUser,
					},
				},
			] as never,
			absencesById: new Map(),
			periodsById: new Map([
				[
					"period-ordinary",
					{
						id: "period-ordinary",
						startTime: new Date("2026-05-22T14:00:00.000Z"),
						endTime: new Date("2026-05-22T18:00:00.000Z"),
						clockIn: {
							id: "clock-in-original",
							timestamp: new Date("2026-05-22T14:00:00.000Z"),
							utcOffsetMinutes: 120,
							ipAddress: "secret-ip",
							deviceInfo: "secret-device",
							location: { latitude: 1, longitude: 2 },
							hash: "secret-hash",
							notes: "secret-note",
						},
						clockOut: null,
						correctionReviewEntries: [],
					},
				],
			] as never),
		});

		const approval = result.timeCorrectionApprovals[0];
		expect(Object.keys(approval?.requester.user ?? {}).sort()).toEqual([
			"email",
			"id",
			"image",
			"name",
		]);
		expect(Object.keys(approval?.workPeriod.clockInEntry ?? {}).sort()).toEqual(
			["timestamp", "utcOffsetMinutes"],
		);
		expect(JSON.stringify(result)).not.toMatch(/secret-/);
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
