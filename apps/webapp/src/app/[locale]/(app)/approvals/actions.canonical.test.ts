import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type {
	ApprovalDecisionAction as DomainApprovalDecisionAction,
	ApprovalType as DomainApprovalType,
	BulkDecisionFailure as DomainBulkDecisionFailure,
	BulkDecisionResult as DomainBulkDecisionResult,
	BulkDecisionSuccess as DomainBulkDecisionSuccess,
} from "@/lib/approvals/domain/types";
import type {
	ApprovalDecisionAction as ActionApprovalDecisionAction,
	ApprovalType as ActionApprovalType,
	BulkDecisionFailure as ActionBulkDecisionFailure,
	BulkDecisionResult as ActionBulkDecisionResult,
	BulkDecisionSuccess as ActionBulkDecisionSuccess,
} from "./actions";

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth",
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

vi.mock("../absences/actions", () => ({
	getCurrentEmployee: vi.fn(),
}));

const mockState = vi.hoisted(() => ({
	dbUpdate: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		update: mockState.dbUpdate,
		query: {
			approvalRequest: { findFirst: vi.fn(), findMany: vi.fn() },
			absenceEntry: { findFirst: vi.fn() },
			workPeriod: { findFirst: vi.fn() },
			employee: { findMany: vi.fn() },
		},
	},
}));

const actions = await import("./actions");

describe("approvals canonical sync", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("updates canonical work record timestamps after correction approval", async () => {
		const whereUpdate = vi.fn().mockResolvedValue(undefined);
		const setUpdate = vi.fn().mockReturnValue({ where: whereUpdate });
		mockState.dbUpdate.mockReturnValue({ set: setUpdate });

		const startAt = new Date("2026-01-01T08:15:00.000Z");
		const endAt = new Date("2026-01-01T17:00:00.000Z");

		await actions.syncCanonicalWorkCorrection({
			canonicalRecordId: "record-1",
			organizationId: "org-1",
			startAt,
			endAt,
			durationMinutes: 525,
			updatedBy: "user-1",
		});

		expect(mockState.dbUpdate).toHaveBeenCalledTimes(1);
		expect(setUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				startAt,
				endAt,
				durationMinutes: 525,
				updatedBy: "user-1",
			}),
		);
		expect(whereUpdate).toHaveBeenCalledTimes(1);
	});

	it("skips canonical work correction sync when linkage is missing", async () => {
		await actions.syncCanonicalWorkCorrection({
			canonicalRecordId: null,
			organizationId: "org-1",
			startAt: new Date("2026-01-01T08:15:00.000Z"),
			endAt: new Date("2026-01-01T17:00:00.000Z"),
			durationMinutes: 525,
			updatedBy: "user-1",
		});

		expect(mockState.dbUpdate).not.toHaveBeenCalled();
	});

	it("re-exports the richer approval contract types", () => {
		const result: ActionBulkDecisionResult = {
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
					code: "validation_failed",
					message: "Missing required data.",
				},
			],
		};

		expect(result.succeeded[0]?.approvalType).toBe("travel_expense_claim");
		expect(result.failed[0]?.code).toBe("validation_failed");

		expectTypeOf<ActionApprovalType>().toEqualTypeOf<DomainApprovalType>();
		expectTypeOf<ActionApprovalDecisionAction>().toEqualTypeOf<DomainApprovalDecisionAction>();
		expectTypeOf<ActionBulkDecisionSuccess>().toEqualTypeOf<DomainBulkDecisionSuccess>();
		expectTypeOf<ActionBulkDecisionFailure>().toEqualTypeOf<DomainBulkDecisionFailure>();
		expectTypeOf<ActionBulkDecisionResult>().toEqualTypeOf<DomainBulkDecisionResult>();
	});
});
