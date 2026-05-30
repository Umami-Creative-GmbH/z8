import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	send: vi.fn(),
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
	DeleteObjectCommand: vi.fn().mockImplementation(function DeleteObjectCommand(input) {
		return { input };
	}),
	S3Client: vi.fn().mockImplementation(function S3Client() {
		return {
			send: mockState.send,
		};
	}),
}));

const {
	createAvatarStorageKey,
	createOrganizationLogoStorageKey,
	deleteOwnedAvatarObject,
	getOwnedAvatarKeyFromPublicUrl,
} = await import("./avatar-storage");

describe("avatar storage", () => {
	beforeEach(() => {
		mockState.send.mockReset();
		vi.mocked(DeleteObjectCommand).mockClear();
	});

	it("creates per-user immutable avatar keys", () => {
		expect(createAvatarStorageKey("user-1", "avatar-id")).toBe("avatars/user-1/avatar-id.webp");
	});

	it("creates per-organization immutable logo keys", () => {
		expect(createOrganizationLogoStorageKey("org-1", "logo-id")).toBe(
			"org-logos/org-1/logo-id.webp",
		);
	});

	it("extracts owned avatar keys from the public S3 URL", () => {
		expect(
			getOwnedAvatarKeyFromPublicUrl(
				"https://cdn.example.com/avatars/user-1/avatar-id.webp",
				"user-1",
			),
		).toBe("avatars/user-1/avatar-id.webp");
		expect(
			getOwnedAvatarKeyFromPublicUrl(
				"https://cdn.example.com/avatars/user-1-1716500000000.webp",
				"user-1",
			),
		).toBe("avatars/user-1-1716500000000.webp");
	});

	it("rejects external, unowned, and non-avatar URLs", () => {
		expect(
			getOwnedAvatarKeyFromPublicUrl(
				"https://other.example.com/avatars/user-1/avatar-id.webp",
				"user-1",
			),
		).toBeNull();
		expect(
			getOwnedAvatarKeyFromPublicUrl(
				"https://cdn.example.com/avatars/user-2/avatar-id.webp",
				"user-1",
			),
		).toBeNull();
		expect(
			getOwnedAvatarKeyFromPublicUrl(
				"https://cdn.example.com/org-logos/user-1/avatar-id.webp",
				"user-1",
			),
		).toBeNull();
	});

	it("deletes only owned avatar objects", async () => {
		mockState.send.mockResolvedValueOnce({});

		await deleteOwnedAvatarObject(
			"https://cdn.example.com/avatars/user-1/avatar-id.webp",
			"user-1",
		);

		expect(DeleteObjectCommand).toHaveBeenCalledWith({
			Bucket: "public-bucket",
			Key: "avatars/user-1/avatar-id.webp",
		});
		expect(mockState.send).toHaveBeenCalledTimes(1);

		await deleteOwnedAvatarObject(
			"https://cdn.example.com/avatars/user-2/avatar-id.webp",
			"user-1",
		);

		expect(mockState.send).toHaveBeenCalledTimes(1);
	});
});
