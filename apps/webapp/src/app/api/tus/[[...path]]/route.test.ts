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
	Server: vi.fn().mockImplementation(function Server(options: Record<string, unknown>) {
		mockState.serverOptions = options;
		return {
			handleWeb: (request: Request) => mockState.handleWeb(request),
		};
	}),
}));

const { POST } = await import("./route");

describe("TUS route", () => {
	beforeEach(() => {
		mockState.handleWeb.mockClear();
		mockState.handleWeb.mockResolvedValue(new Response(null, { status: 204 }));
	});

	it("rejects POST upload creation requests missing upload-length", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/tus", {
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: "Invalid upload length" });
		expect(mockState.handleWeb).not.toHaveBeenCalled();
	});

	it("rejects POST upload creation requests with non-numeric upload-length", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/tus", {
				method: "POST",
				headers: { "upload-length": "not-a-number" },
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: "Invalid upload length" });
		expect(mockState.handleWeb).not.toHaveBeenCalled();
	});

	it("rejects POST upload creation requests with negative upload-length", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/tus", {
				method: "POST",
				headers: { "upload-length": "-1" },
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: "Invalid upload length" });
		expect(mockState.handleWeb).not.toHaveBeenCalled();
	});

	it("rejects POST upload creation requests with fractional upload-length", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/tus", {
				method: "POST",
				headers: { "upload-length": "1.5" },
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: "Invalid upload length" });
		expect(mockState.handleWeb).not.toHaveBeenCalled();
	});

	it("rejects POST upload creation requests with deferred upload length", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/tus", {
				method: "POST",
				headers: { "upload-defer-length": "1" },
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: "Invalid upload length" });
		expect(mockState.handleWeb).not.toHaveBeenCalled();
	});

	it("keeps nested temporary upload keys intact across generated and incoming URLs", () => {
		const options = mockState.serverOptions;
		const id = ".tmp/tus/dXNlcl8x-upload";
		const request = new Request("https://app.example.com/api/tus", {
			headers: { host: "app.example.com" },
		});

		expect(options?.generateUrl).toBeTypeOf("function");
		expect(options?.getFileIdFromRequest).toBeTypeOf("function");

		const location = (
			options?.generateUrl as (
				request: Request,
				params: { proto: string; host: string; path: string; id: string },
			) => string
		)(request, {
			proto: "https",
			host: "app.example.com",
			path: "/api/tus",
			id,
		});
		expect(location).toBe("https://app.example.com/api/tus/.tmp%2Ftus%2FdXNlcl8x-upload");

		const uploadRequest = new Request(location);
		expect((options?.getFileIdFromRequest as (request: Request) => string)(uploadRequest)).toBe(id);
	});

	it("rejects oversized POST upload creation requests before TUS handling", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/tus", {
				method: "POST",
				headers: { "upload-length": String(10 * 1024 * 1024 + 1) },
			}),
		);

		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toEqual({ error: "File too large" });
		expect(mockState.handleWeb).not.toHaveBeenCalled();
	});

	it("rejects invalid recognized upload metadata content types before TUS handling", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/tus", {
				method: "POST",
				headers: {
					"upload-length": "1024",
					"upload-metadata": `content-type ${btoa("text/plain")}`,
				},
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: "Invalid file type" });
		expect(mockState.handleWeb).not.toHaveBeenCalled();
	});

	it("rejects invalid alternate MIME metadata keys before TUS handling", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/tus", {
				method: "POST",
				headers: {
					"upload-length": "1024",
					"upload-metadata": `type ${btoa("text/plain")}`,
				},
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: "Invalid file type" });
		expect(mockState.handleWeb).not.toHaveBeenCalled();
	});

	it("allows valid non-image metadata through to TUS handling", async () => {
		const request = new Request("https://app.example.com/api/tus", {
			method: "POST",
			headers: {
				"upload-length": "1024",
				"upload-metadata": `content-type ${btoa("application/pdf")}`,
			},
		});

		const response = await POST(request);

		expect(response.status).toBe(204);
		expect(mockState.handleWeb).toHaveBeenCalledWith(request);
	});

	it("allows valid POST upload creation lengths through to TUS handling", async () => {
		const request = new Request("https://app.example.com/api/tus", {
			method: "POST",
			headers: { "upload-length": "1024" },
		});

		const response = await POST(request);

		expect(response.status).toBe(204);
		expect(mockState.handleWeb).toHaveBeenCalledWith(request);
	});
});
