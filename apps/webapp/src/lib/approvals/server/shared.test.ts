import { describe, expect, it, vi } from "vitest";

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

import { getApprovalStatusUpdate } from "@/lib/approvals/server/shared";

describe("getApprovalStatusUpdate", () => {
	it("builds approved status payload", () => {
		const result = getApprovalStatusUpdate("approve");

		expect(result.status).toBe("approved");
		expect(result.approvedAt).toBeDefined();
		expect(result.rejectionReason).toBeUndefined();
		expect(result.updatedAt).toBeDefined();
	});

	it("builds rejected status payload", () => {
		const result = getApprovalStatusUpdate("reject", "missing details");

		expect(result.status).toBe("rejected");
		expect(result.approvedAt).toBeUndefined();
		expect(result.rejectionReason).toBe("missing details");
		expect(result.updatedAt).toBeDefined();
	});
});
