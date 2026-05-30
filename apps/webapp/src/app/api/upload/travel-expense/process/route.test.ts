import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	authContext: {
		user: { id: "user_1" },
		employee: { id: "emp_1", organizationId: "org_1" },
	},
	publicSend: vi.fn(),
	uploadPrivateObject: vi.fn(),
	claimFindFirst: vi.fn(),
	insert: vi.fn(),
	values: vi.fn(),
	returning: vi.fn(),
	deleteCommand: vi.fn(),
	getCommand: vi.fn(),
}));

vi.mock("next/server", () => ({
	connection: vi.fn(),
	NextResponse: {
		json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: vi.fn(() => mockState.authContext),
}));

vi.mock("@/lib/upload/tus-ownership", () => ({
	sanitizeTusFileKey: vi.fn(() => "tus-user_1-upload"),
}));

vi.mock("file-type", () => ({
	fileTypeFromBuffer: vi.fn(() => Promise.resolve({ ext: "pdf", mime: "application/pdf" })),
}));

vi.mock("@/lib/travel-expenses/attachment-validation", () => ({
	isAllowedTravelExpenseMime: vi.fn(() => true),
}));

vi.mock("@aws-sdk/client-s3", () => ({
	GetObjectCommand: vi.fn().mockImplementation(function GetObjectCommand(input) {
		mockState.getCommand(input);
		return { input, type: "get" };
	}),
	DeleteObjectCommand: vi.fn().mockImplementation(function DeleteObjectCommand(input) {
		mockState.deleteCommand(input);
		return { input, type: "delete" };
	}),
	PutObjectCommand: vi.fn().mockImplementation(function PutObjectCommand(input) {
		return { input, type: "put" };
	}),
}));

vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "public-temp-bucket",
	s3Client: { send: mockState.publicSend },
}));

vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadPrivateObject: mockState.uploadPrivateObject,
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
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			travelExpenseClaim: { findFirst: mockState.claimFindFirst },
		},
		insert: mockState.insert,
	},
}));

const { POST } = await import("./route");

describe("travel expense upload processing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.claimFindFirst.mockResolvedValue({
			id: "claim_1",
			organizationId: "org_1",
		});
		mockState.publicSend.mockImplementation((command) => {
			if (command.type === "get") {
				return Promise.resolve({
					ContentLength: 8,
					Body: {
						transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])),
					},
				});
			}

			return Promise.resolve({});
		});
		mockState.uploadPrivateObject.mockResolvedValue({
			bucket: "private-bucket",
		});
		mockState.returning.mockResolvedValue([
			{
				id: "attachment_1",
				fileName: "receipt.pdf",
				mimeType: "application/pdf",
				sizeBytes: 4,
				storageKey: "travel-expenses/org_1/claim_1/123-receipt.pdf",
			},
		]);
		mockState.values.mockReturnValue({ returning: mockState.returning });
		mockState.insert.mockReturnValue({ values: mockState.values });
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
		expect(mockState.uploadPrivateObject).toHaveBeenCalledWith(
			"org_1",
			expect.stringMatching(/^travel-expenses\/org_1\/claim_1\/\d+-receipt\.pdf$/),
			expect.any(Buffer),
			"application/pdf",
			expect.objectContaining({
				"uploaded-by": "emp_1",
				"original-key": "tus-user_1-upload",
			}),
		);
		expect(mockState.values).toHaveBeenCalledWith(
			expect.objectContaining({
				storageProvider: "s3-private",
				storageBucket: "private-bucket",
			}),
		);
		expect(mockState.deleteCommand).toHaveBeenCalledWith({
			Bucket: "public-temp-bucket",
			Key: "tus-user_1-upload",
		});
	});
});
