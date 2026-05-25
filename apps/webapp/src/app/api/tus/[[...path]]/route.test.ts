import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	handleWeb: vi.fn(),
	serverOptions: undefined as Record<string, unknown> | undefined,
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
			getSession: vi.fn(() => Promise.resolve({ user: { id: "user_1" } })),
		},
	},
}));

vi.mock("@/env", () => ({
	env: {
		S3_PUBLIC_ENDPOINT: "https://s3.example.com",
		S3_PUBLIC_FORCE_PATH_STYLE: "true",
		S3_PUBLIC_ACCESS_KEY_ID: "access-key",
		S3_PUBLIC_SECRET_ACCESS_KEY: "secret-key",
	},
}));

vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "public-bucket",
	S3_PUBLIC_REGION: "fr-par",
}));

vi.mock("@tus/s3-store", () => ({
	S3Store: vi.fn().mockImplementation(
		class {
			readonly options: unknown;

			constructor(options: unknown) {
				this.options = options;
			}
		},
	),
}));

vi.mock("@tus/server", () => ({
	Server: vi.fn().mockImplementation(
		class {
			constructor(options: Record<string, unknown>) {
				mockState.serverOptions = options;
			}

			handleWeb(request: Request) {
				return mockState.handleWeb(request);
			}
		},
	),
}));

await import("./route");

describe("TUS route", () => {
	beforeEach(() => {
		mockState.handleWeb.mockResolvedValue(new Response(null, { status: 204 }));
	});

	it("keeps nested temporary upload keys intact across generated and incoming URLs", () => {
		const options = mockState.serverOptions;
		const id = ".tmp/tus/dXNlcl8x-upload";
		const request = new Request("https://app.example.com/api/tus", {
			headers: { host: "app.example.com" },
		});

		expect(options?.generateUrl).toBeTypeOf("function");
		expect(options?.getFileIdFromRequest).toBeTypeOf("function");

		const location = (options?.generateUrl as Function)(request, {
			proto: "https",
			host: "app.example.com",
			path: "/api/tus",
			id,
		});
		expect(location).toBe("https://app.example.com/api/tus/.tmp%2Ftus%2FdXNlcl8x-upload");

		const uploadRequest = new Request(location);
		expect((options?.getFileIdFromRequest as Function)(uploadRequest)).toBe(id);
	});
});
