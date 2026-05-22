import { describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	lastConfig: undefined as unknown,
}));

vi.mock("@/env", () => ({
	env: {
		S3_PUBLIC_BUCKET: "public-bucket",
		S3_PUBLIC_ACCESS_KEY_ID: "public-access-key",
		S3_PUBLIC_SECRET_ACCESS_KEY: "public-secret-key",
		S3_PUBLIC_ENDPOINT: "https://public-s3.example.com",
		S3_PUBLIC_REGION: "eu-central-1",
		S3_PUBLIC_FORCE_PATH_STYLE: "false",
		S3_PUBLIC_URL: "https://cdn.example.com",
	},
}));

vi.mock("@aws-sdk/client-s3", () => ({
	S3Client: vi.fn().mockImplementation(function (config) {
		mockState.lastConfig = config;
		return {};
	}),
}));

const { getPublicUrl, S3_PUBLIC_BUCKET, S3_PUBLIC_REGION } = await import("./s3-client");

describe("public S3 client", () => {
	it("uses explicitly public S3 environment variables", () => {
		expect(S3_PUBLIC_BUCKET).toBe("public-bucket");
		expect(S3_PUBLIC_REGION).toBe("eu-central-1");
		expect(getPublicUrl("avatars/user.webp")).toBe("https://cdn.example.com/avatars/user.webp");
		expect(mockState.lastConfig).toMatchObject({
			endpoint: "https://public-s3.example.com",
			region: "eu-central-1",
			forcePathStyle: false,
			credentials: {
				accessKeyId: "public-access-key",
				secretAccessKey: "public-secret-key",
			},
		});
	});
});
