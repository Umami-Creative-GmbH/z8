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

import { formatAbsenceDateForEmail } from "@/lib/approvals/server/absence-approvals";

describe("formatAbsenceDateForEmail", () => {
	it("formats dates for absence emails", () => {
		expect(formatAbsenceDateForEmail(new Date("2026-03-09T00:00:00.000Z"))).toBe(
			"Mar 9, 2026",
		);
	});
});
