import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getSession: vi.fn(),
	updateOrganization: vi.fn(),
	memberFindFirst: vi.fn(),
	s3Send: vi.fn(),
	getCommand: vi.fn(),
	putCommand: vi.fn(),
	deleteCommand: vi.fn(),
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock("next/server", () => ({
	connection: vi.fn(),
	NextResponse: {
		json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
	},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
			updateOrganization: mockState.updateOrganization,
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({
	member: {
		userId: "member.userId",
		organizationId: "member.organizationId",
	},
	organization: {
		id: "organization.id",
		logo: "organization.logo",
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: { findFirst: mockState.memberFindFirst },
		},
	},
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ type: "and", conditions }),
	eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
}));

vi.mock("@aws-sdk/client-s3", () => ({
	GetObjectCommand: vi.fn().mockImplementation(
		class {
			readonly input: unknown;
			readonly type = "get";

			constructor(input: unknown) {
				this.input = input;
				mockState.getCommand(input);
			}
		},
	),
	PutObjectCommand: vi.fn().mockImplementation(
		class {
			readonly input: unknown;
			readonly type = "put";

			constructor(input: unknown) {
				this.input = input;
				mockState.putCommand(input);
			}
		},
	),
	DeleteObjectCommand: vi.fn().mockImplementation(
		class {
			readonly input: unknown;
			readonly type = "delete";

			constructor(input: unknown) {
				this.input = input;
				mockState.deleteCommand(input);
			}
		},
	),
}));

vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "public-bucket",
	getPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
	s3Client: { send: mockState.s3Send },
}));

vi.mock("@/lib/upload/tus-ownership", () => ({
	sanitizeTusFileKey: vi.fn(() => ".tmp/tus/dXNlcl8x-upload"),
}));

vi.mock("@/lib/storage/avatar-storage", () => ({
	createAvatarStorageKey: vi.fn(() => "avatars/user_1/avatar.webp"),
	createOrganizationLogoStorageKey: vi.fn(() => "org-logos/org_1/logo-id.webp"),
}));

vi.mock("file-type", () => ({
	fileTypeFromBuffer: vi.fn(() => Promise.resolve({ ext: "png", mime: "image/png" })),
}));

vi.mock("sharp", () => ({
	default: vi.fn(() => ({
		resize: vi.fn().mockReturnThis(),
		webp: vi.fn().mockReturnThis(),
		toBuffer: vi.fn(() => Promise.resolve(Buffer.from([1, 2, 3]))),
	})),
}));

const { POST } = await import("./route");

describe("image upload processing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getSession.mockResolvedValue({ user: { id: "user_1" } });
		mockState.memberFindFirst.mockResolvedValue({ role: "owner" });
		mockState.s3Send.mockImplementation((command) => {
			if (command.type === "get") {
				return Promise.resolve({
					ContentLength: 4,
					Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])) },
				});
			}

			return Promise.resolve({});
		});
		mockState.updateOrganization.mockResolvedValue({});
	});

	it("authorizes organization logo processing from the scoped member record", async () => {
		const response = await POST({
			json: () =>
				Promise.resolve({
					tusFileKey: ".tmp/tus/dXNlcl8x-upload",
					uploadType: "org-logo",
					organizationId: "org_1",
				}),
		} as never);

		expect(response.status).toBe(200);
		expect(mockState.memberFindFirst).toHaveBeenCalled();
		expect(mockState.updateOrganization).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			body: {
				organizationId: "org_1",
				data: {
					logo: expect.stringMatching(
						/^https:\/\/cdn\.example\.com\/org-logos\/org_1\/[A-Za-z0-9_-]+\.webp$/,
					),
				},
			},
		});
	});
});
