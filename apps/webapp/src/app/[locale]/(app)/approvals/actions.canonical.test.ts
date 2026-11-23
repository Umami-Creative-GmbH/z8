import { beforeEach, describe, expect, it, vi } from "vitest";

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
	it("returns the active organization's current employee for shared callers", async () => {
		const employee = { id: "employee-1", organizationId: "org-a", role: "employee" };
		vi.mocked(getCurrentEmployee).mockResolvedValue(employee as never);

		await expect(actions.getCurrentEmployee()).resolves.toBe(employee);
	});

	it("no longer exports a separate canonical work sync of time corrections (#1227)", () => {
		expect(actions).not.toHaveProperty("syncCanonicalWorkCorrection");
	});

	it("no longer exposes the retired legacy queue reads and decisions (#1976)", () => {
		for (const retired of [
			"approveAbsence",
			"rejectAbsence",
			"getPendingApprovals",
			"getPendingApprovalCounts",
		]) {
			expect(actions).not.toHaveProperty(retired);
		}
	});
});
