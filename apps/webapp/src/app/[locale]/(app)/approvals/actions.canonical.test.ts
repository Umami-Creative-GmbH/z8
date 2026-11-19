import { readFileSync } from "node:fs";
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
		SCIM_CREDENTIAL_HASH_SECRET: "test-scim-credential-hash-secret-value",
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

vi.mock("../absences/actions", () => ({
	getCurrentEmployee: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: { findFirst: vi.fn(), findMany: vi.fn() },
			absenceEntry: { findFirst: vi.fn() },
			workPeriod: { findFirst: vi.fn() },
			employee: { findMany: vi.fn() },
		},
	},
}));

const actions = await import("./actions");
const { getCurrentEmployee } = await import("../absences/actions");

describe("approvals actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	it.each([
		null,
		{ userId: "viewer", organizationId: "another-org", role: "manager" },
		{ userId: "another-viewer", organizationId: "org-a", role: "manager" },
		{ userId: "viewer", organizationId: "org-a", role: "employee" },
	])(
		"refuses a stale scoped queue read before returning records",
		async (employee) => {
			vi.mocked(getCurrentEmployee).mockResolvedValue(employee as never);
			await expect(
				actions.getPendingApprovals("en", {
					userId: "viewer",
					organizationId: "org-a",
				}),
			).rejects.toThrow("Approval scope changed");
		},
	);

	it("no longer exports a separate canonical work sync of time corrections (#1227)", () => {
		expect(actions).not.toHaveProperty("syncCanonicalWorkCorrection");
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

	it("resolves the current recipient profile inside the active organization before formatting rows", () => {
		const source = readFileSync(
			"src/app/[locale]/(app)/approvals/actions.ts",
			"utf8",
		);

		expect(source).toMatch(
			/getEffectiveTimezone\(\s*currentEmployee.userId,\s*currentEmployee.organizationId,?\s*\)/,
		);
		expect(source).toContain("getUserTimeFormat(currentEmployee.userId)");
	});
});
