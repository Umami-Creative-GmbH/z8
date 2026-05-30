import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findFirst: vi.fn(),
	getOrgSecret: vi.fn(),
	getSignedUrl: vi.fn(),
	send: vi.fn(),
	lastS3Config: undefined as unknown,
	lastGetObjectCommand: undefined as unknown,
	lastPutObjectCommand: undefined as unknown,
}));

vi.mock("@/env", () => ({
	env: {
		S3_PRIVATE_BUCKET: "private-export-bucket",
		S3_PRIVATE_ACCESS_KEY_ID: "private-access-key",
		S3_PRIVATE_SECRET_ACCESS_KEY: "private-secret-key",
		S3_PRIVATE_ENDPOINT: "https://private-s3.example.com",
		S3_PRIVATE_REGION: "eu-central-1",
		S3_PRIVATE_FORCE_PATH_STYLE: "false",
		S3_PRIVATE_PRESIGNED_URL_TTL_SECONDS: "600",
	},
}));

vi.mock("@/db", () => ({
	exportStorageConfig: {
		organizationId: "organization_id",
	},
	db: {
		query: {
			exportStorageConfig: {
				findFirst: mockState.findFirst,
			},
		},
	},
}));

vi.mock("@/lib/vault", () => ({
	getOrgSecret: mockState.getOrgSecret,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

vi.mock("@aws-sdk/client-s3", () => ({
	S3Client: vi.fn().mockImplementation(function S3Client(config) {
		mockState.lastS3Config = config;
		return { send: mockState.send };
	}),
	GetObjectCommand: vi.fn().mockImplementation(function GetObjectCommand(input) {
		mockState.lastGetObjectCommand = input;
		return { input };
	}),
	PutObjectCommand: vi.fn().mockImplementation(function PutObjectCommand(input) {
		mockState.lastPutObjectCommand = input;
		return { input };
	}),
	DeleteObjectCommand: vi.fn(),
	HeadObjectCommand: vi.fn(),
	ListBucketsCommand: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
	getSignedUrl: mockState.getSignedUrl,
}));

const { getPresignedUrl, getStorageConfig, isExportS3Configured, uploadExport } = await import(
	"./export-s3-client"
);

describe("export S3 client", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.findFirst.mockResolvedValue(null);
		mockState.getOrgSecret.mockReset();
		mockState.getSignedUrl.mockResolvedValue("https://signed.example.com/export.zip");
		mockState.send.mockResolvedValue({});
		mockState.lastS3Config = undefined;
		mockState.lastGetObjectCommand = undefined;
		mockState.lastPutObjectCommand = undefined;
	});

	it("falls back to app-managed private S3 when an organization has no storage config", async () => {
		await expect(getStorageConfig("org_1")).resolves.toEqual({
			bucket: "private-export-bucket",
			accessKeyId: "private-access-key",
			secretAccessKey: "private-secret-key",
			region: "eu-central-1",
			endpoint: "https://private-s3.example.com",
			forcePathStyle: false,
		});

		await expect(isExportS3Configured("org_1")).resolves.toBe(true);
		expect(mockState.getOrgSecret).not.toHaveBeenCalled();
	});

	it("prefers organization-owned storage when it is configured", async () => {
		mockState.findFirst.mockResolvedValue({
			bucket: "org-bucket",
			region: "us-east-1",
			endpoint: "https://org-s3.example.com",
		});
		mockState.getOrgSecret
			.mockResolvedValueOnce("org-access-key")
			.mockResolvedValueOnce("org-secret-key");

		await expect(getStorageConfig("org_1")).resolves.toEqual({
			bucket: "org-bucket",
			accessKeyId: "org-access-key",
			secretAccessKey: "org-secret-key",
			region: "us-east-1",
			endpoint: "https://org-s3.example.com",
			forcePathStyle: true,
		});
	});

	it("uses short-lived private presigned URLs by default", async () => {
		await expect(getPresignedUrl("org_1", "audit-exports/org_1/export.zip")).resolves.toBe(
			"https://signed.example.com/export.zip",
		);

		expect(mockState.lastS3Config).toMatchObject({
			endpoint: "https://private-s3.example.com",
			region: "eu-central-1",
			forcePathStyle: false,
		});
		expect(mockState.lastGetObjectCommand).toEqual({
			Bucket: "private-export-bucket",
			Key: "audit-exports/org_1/export.zip",
		});
		expect(mockState.getSignedUrl).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), {
			expiresIn: 600,
		});
	});

	it("uploads exports to the private fallback bucket", async () => {
		await uploadExport("org_1", "audit-exports/org_1/export.zip", "zip-data", "application/zip");

		expect(mockState.lastPutObjectCommand).toMatchObject({
			Bucket: "private-export-bucket",
			Key: "audit-exports/org_1/export.zip",
			Body: "zip-data",
			ContentType: "application/zip",
		});
		expect(mockState.send).toHaveBeenCalledTimes(1);
	});
});
