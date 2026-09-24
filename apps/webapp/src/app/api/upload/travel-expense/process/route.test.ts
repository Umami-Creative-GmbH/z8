import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	authContext: {
		user: { id: "user_1" },
		employee: { id: "emp_1", organizationId: "org_1" },
	},
	publicSend: vi.fn(),
	uploadPrivateObject: vi.fn(),
	claimFindFirst: vi.fn(),
	deleteCommand: vi.fn(),
	getCommand: vi.fn(),
	calls: [] as string[],
	stage: vi.fn(),
	finalize: vi.fn(),
	markFailed: vi.fn(),
	runCleanup: vi.fn(),
	deletePrivateObject: vi.fn(),
}));

vi.mock("next/server", () => ({
	connection: vi.fn(),
	NextResponse: {
		json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
	},
}));

vi.mock("@/env", () => ({
	env: {
		TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES: "1024",
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: vi.fn(() => mockState.authContext),
}));

vi.mock("@/lib/upload/tus-ownership", () => ({
	sanitizeTusFileKey: vi.fn(() => "tus-user_1-upload"),
}));

vi.mock("file-type", () => ({
	fileTypeFromBuffer: vi.fn(() =>
		Promise.resolve({ ext: "pdf", mime: "application/pdf" }),
	),
}));

vi.mock("@/lib/travel-expenses/attachment-validation", () => ({
	isAllowedTravelExpenseMime: vi.fn(() => true),
}));

vi.mock("@aws-sdk/client-s3", () => ({
	GetObjectCommand: vi
		.fn()
		.mockImplementation(function GetObjectCommand(input) {
			mockState.getCommand(input);
			return { input, type: "get" };
		}),
	DeleteObjectCommand: vi
		.fn()
		.mockImplementation(function DeleteObjectCommand(input) {
			mockState.deleteCommand(input);
			return { input, type: "delete" };
		}),
	PutObjectCommand: vi
		.fn()
		.mockImplementation(function PutObjectCommand(input) {
			return { input, type: "put" };
		}),
}));

vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "public-temp-bucket",
	s3Client: { send: mockState.publicSend },
}));

vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadPrivateObject: mockState.uploadPrivateObject,
	deletePrivateObject: mockState.deletePrivateObject,
}));

vi.mock("@/lib/travel-expenses/receipt-upload", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/travel-expenses/receipt-upload")>()),
	stageTravelExpenseReceiptUpload: mockState.stage,
	finalizeTravelExpenseReceiptUpload: mockState.finalize,
	markTravelExpenseReceiptUploadFailed: mockState.markFailed,
	runTravelExpenseReceiptCleanup: mockState.runCleanup,
}));

vi.mock("@/db/schema", () => ({
	travelExpenseAttachment: {
		id: "attachment.id",
		fileName: "attachment.fileName",
		mimeType: "attachment.mimeType",
		sizeBytes: "attachment.sizeBytes",
		storageKey: "attachment.storageKey",
	},
	travelExpenseClaim: {
		id: "claim.id",
		organizationId: "claim.organizationId",
		employeeId: "claim.employeeId",
		status: "claim.status",
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			travelExpenseClaim: { findFirst: mockState.claimFindFirst },
		},
	},
}));

const { POST } = await import("./route");

describe("travel expense upload processing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.claimFindFirst.mockResolvedValue({
			id: "claim_1",
			organizationId: "org_1",
			status: "draft",
		});
		mockState.publicSend.mockImplementation((command) => {
			if (command.type === "get") {
				return Promise.resolve({
					ContentLength: 8,
					Body: {
						transformToByteArray: () =>
							Promise.resolve(new Uint8Array([1, 2, 3, 4])),
					},
				});
			}

			return Promise.resolve({});
		});
		mockState.calls = [];
		mockState.stage.mockImplementation(async () => {
			mockState.calls.push("stage");
		});
		mockState.uploadPrivateObject.mockImplementation(async () => {
			mockState.calls.push("upload");
			return { bucket: "private-bucket", versionId: "v1" };
		});
		mockState.finalize.mockImplementation(async (_db, input) => {
			mockState.calls.push("finalize");
			return {
				kind: "attached",
				attachment: {
					id: input.attachmentId,
					fileName: input.fileName,
					mimeType: input.mimeType,
					sizeBytes: input.sizeBytes,
					storageKey: input.storageKey,
				},
			};
		});
		mockState.markFailed.mockResolvedValue(undefined);
		mockState.runCleanup.mockResolvedValue({
			claimed: 1,
			deleted: 1,
			released: 0,
			failed: 0,
		});
	});

	it("reads and deletes temporary uploads from public S3 but stores final receipts in private S3", async () => {
		const response = await POST({
			json: () =>
				Promise.resolve({
					tusFileKey: "tus-user_1-upload",
					claimId: "claim_1",
					fileName: "receipt.pdf",
				}),
		} as never);

		expect(response.status).toBe(200);
		expect(mockState.getCommand).toHaveBeenCalledWith({
			Bucket: "public-temp-bucket",
			Key: "tus-user_1-upload",
		});
		const checksum = createHash("sha256")
			.update(Buffer.from([1, 2, 3, 4]))
			.digest("hex");
		expect(mockState.uploadPrivateObject).toHaveBeenCalledWith(
			"org_1",
			expect.stringMatching(
				/^travel-expenses\/org_1\/claim_1\/[0-9a-f-]{36}-receipt\.pdf$/,
			),
			expect.any(Buffer),
			"application/pdf",
			expect.objectContaining({
				"uploaded-by": "emp_1",
				"original-key": "tus-user_1-upload",
				"content-sha256": checksum,
			}),
		);
		const [, staged] = mockState.stage.mock.calls[0] ?? [];
		expect(staged).toEqual(
			expect.objectContaining({
				organizationId: "org_1",
				claimId: "claim_1",
				uploadedBy: "emp_1",
			}),
		);
		expect(staged.storageKey).toBe(
			`travel-expenses/org_1/claim_1/${staged.attachmentId}-receipt.pdf`,
		);
		expect(mockState.finalize).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				...staged,
				stored: { bucket: "private-bucket", versionId: "v1" },
				checksumSha256: checksum,
				sizeBytes: 4,
				mimeType: "application/pdf",
			}),
		);
		expect(mockState.calls).toEqual(["stage", "upload", "finalize"]);
		expect(mockState.deleteCommand).toHaveBeenCalledWith({
			Bucket: "public-temp-bucket",
			Key: "tus-user_1-upload",
		});
	});

	it("does not process an upload for a claim outside the active organization", async () => {
		mockState.claimFindFirst.mockResolvedValue(null);

		const response = await POST({
			json: () =>
				Promise.resolve({
					tusFileKey: "tus-user_1-upload",
					claimId: "claim_other_org",
					fileName: "receipt.pdf",
				}),
		} as never);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: "Travel expense claim not found",
		});
		expect(mockState.publicSend).not.toHaveBeenCalled();
		expect(mockState.uploadPrivateObject).not.toHaveBeenCalled();
		expect(mockState.stage).not.toHaveBeenCalled();
	});

	it("rejects travel expense uploads whose metadata exceeds the configured limit", async () => {
		mockState.publicSend.mockResolvedValueOnce({ ContentLength: 1025 });

		const response = await POST({
			json: () =>
				Promise.resolve({
					tusFileKey: "tus-user_1-upload",
					claimId: "claim_1",
					fileName: "receipt.pdf",
				}),
		} as never);

		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toEqual({
			error: "File too large. Maximum size is 1KB",
		});
	});

	it("rejects travel expense uploads whose downloaded buffer exceeds the configured limit", async () => {
		mockState.publicSend.mockResolvedValueOnce({
			ContentLength: 1024,
			Body: {
				transformToByteArray: () => Promise.resolve(new Uint8Array(1025)),
			},
		});

		const response = await POST({
			json: () =>
				Promise.resolve({
					tusFileKey: "tus-user_1-upload",
					claimId: "claim_1",
					fileName: "receipt.pdf",
				}),
		} as never);

		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toEqual({
			error: "File too large. Maximum size is 1KB",
		});
	});

	it("processes a travel expense whose downloaded buffer equals the configured limit", async () => {
		mockState.publicSend.mockResolvedValueOnce({
			ContentLength: 1024,
			Body: {
				transformToByteArray: () => Promise.resolve(new Uint8Array(1024)),
			},
		});

		const response = await POST({
			json: () =>
				Promise.resolve({
					tusFileKey: "tus-user_1-upload",
					claimId: "claim_1",
					fileName: "receipt.pdf",
				}),
		} as never);

		expect(response.status).toBe(200);
		expect(mockState.uploadPrivateObject).toHaveBeenCalled();
	});

	it("rejects a late upload after submission and leaves the object for cleanup", async () => {
		mockState.finalize.mockResolvedValue({ kind: "claim_not_draft" });

		const response = await POST({
			json: () =>
				Promise.resolve({
					tusFileKey: "tus-user_1-upload",
					claimId: "claim_1",
					fileName: "receipt.pdf",
				}),
		} as never);

		expect(response.status).toBe(409);
		const [, staged] = mockState.stage.mock.calls[0] ?? [];
		expect(mockState.runCleanup).toHaveBeenCalledWith(expect.anything(), {
			deleteObject: mockState.deletePrivateObject,
			only: { attachmentId: staged.attachmentId, organizationId: "org_1" },
		});
		expect(mockState.markFailed).not.toHaveBeenCalled();
		expect(mockState.deleteCommand).toHaveBeenCalledWith({
			Bucket: "public-temp-bucket",
			Key: "tus-user_1-upload",
		});
	});

	it("keeps the rejected object recorded when immediate cleanup fails", async () => {
		mockState.finalize.mockResolvedValue({ kind: "claim_not_draft" });
		mockState.runCleanup.mockRejectedValue(new Error("storage unavailable"));

		const response = await POST({
			json: () =>
				Promise.resolve({
					tusFileKey: "tus-user_1-upload",
					claimId: "claim_1",
					fileName: "receipt.pdf",
				}),
		} as never);

		expect(response.status).toBe(409);
	});

	it("records cleanup work when storing or attaching the receipt fails", async () => {
		mockState.uploadPrivateObject.mockRejectedValue(new Error("put failed"));

		const response = await POST({
			json: () =>
				Promise.resolve({
					tusFileKey: "tus-user_1-upload",
					claimId: "claim_1",
					fileName: "receipt.pdf",
				}),
		} as never);

		expect(response.status).toBe(500);
		const [, staged] = mockState.stage.mock.calls[0] ?? [];
		expect(mockState.markFailed).toHaveBeenCalledWith(expect.anything(), {
			...staged,
			stored: null,
			reason: "finalization_failed",
		});
		expect(mockState.finalize).not.toHaveBeenCalled();
	});

	it("does not store anything when the staging claim cannot be written", async () => {
		mockState.stage.mockRejectedValue(new Error("db down"));

		const response = await POST({
			json: () =>
				Promise.resolve({
					tusFileKey: "tus-user_1-upload",
					claimId: "claim_1",
					fileName: "receipt.pdf",
				}),
		} as never);

		expect(response.status).toBe(500);
		expect(mockState.uploadPrivateObject).not.toHaveBeenCalled();
	});

	it.each([
		"submitted",
		"rejected",
		"approved",
	])("does not process an upload for a %s claim", async (status) => {
		mockState.claimFindFirst.mockResolvedValue({
			id: "claim_1",
			organizationId: "org_1",
			status,
		});

		const response = await POST({
			json: () =>
				Promise.resolve({
					tusFileKey: "tus-user_1-upload",
					claimId: "claim_1",
					fileName: "receipt.pdf",
				}),
		} as never);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: "Travel expense claim not found",
		});
		expect(mockState.publicSend).not.toHaveBeenCalled();
		expect(mockState.uploadPrivateObject).not.toHaveBeenCalled();
		expect(mockState.stage).not.toHaveBeenCalled();
	});
});
