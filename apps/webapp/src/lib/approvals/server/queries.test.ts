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

import { buildPendingApprovalResult } from "@/lib/approvals/server/queries";

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
});
