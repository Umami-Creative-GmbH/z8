import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	classifyDomainHost: vi.fn(),
	resolvePlatformOrganization: vi.fn(),
	handlers: {
		GET: vi.fn(() => Response.json({ method: "GET" })),
		POST: vi.fn(() => Response.json({ method: "POST" })),
		PUT: vi.fn(() => Response.json({ method: "PUT" })),
		PATCH: vi.fn(() => Response.json({ method: "PATCH" })),
		DELETE: vi.fn(() => Response.json({ method: "DELETE" })),
	},
}));

vi.mock("better-auth/next-js", () => ({
	toNextJsHandler: vi.fn(() => mockState.handlers),
}));

vi.mock("@/lib/auth", () => ({ auth: {} }));

vi.mock("@/lib/domain", () => ({
	classifyDomainHost: mockState.classifyDomainHost,
	resolvePlatformOrganization: mockState.resolvePlatformOrganization,
}));

const route = await import("./route");
const { rejectUnsupportedPlatformHost } = route;

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

describe("rejectUnsupportedPlatformHost", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.classifyDomainHost.mockImplementation((host: string | null) => {
			if (host === "missing.ui.z8-time.app") {
				return {
					type: "platformOrganization",
					hostname: "missing.ui.z8-time.app",
					label: "missing",
					rootDomain: "ui.z8-time.app",
				};
			}

			if (host === "acme.ui.z8-time.app") {
				return {
					type: "platformOrganization",
					hostname: "acme.ui.z8-time.app",
					label: "acme",
					rootDomain: "ui.z8-time.app",
				};
			}

			if (host === "ui.z8-time.app") {
				return { type: "main", hostname: "ui.z8-time.app" };
			}

			return null;
		});
	});

	it("rejects missing forwarded platform organizations before Better Auth", async () => {
		mockState.resolvePlatformOrganization.mockResolvedValue(null);

		const response = await rejectUnsupportedPlatformHost(
			new Request("https://ui.z8-time.app/api/auth/session", {
				headers: {
					host: "ui.z8-time.app",
					"x-forwarded-host": "missing.ui.z8-time.app",
				},
			}),
		);

		expect(response?.status).toBe(404);
		await expect(response?.json()).resolves.toEqual({ error: "Not found" });
		expect(mockState.resolvePlatformOrganization).toHaveBeenCalledOnce();
		expect(mockState.resolvePlatformOrganization).toHaveBeenCalledWith(
			"missing",
		);
	});

	it("allows existing platform organizations", async () => {
		mockState.resolvePlatformOrganization.mockResolvedValue({ id: "org_123" });

		const response = await rejectUnsupportedPlatformHost(
			new Request("https://acme.ui.z8-time.app/api/auth/session", {
				headers: { host: "acme.ui.z8-time.app" },
			}),
		);

		expect(response).toBeNull();
		expect(mockState.resolvePlatformOrganization).toHaveBeenCalledOnce();
		expect(mockState.resolvePlatformOrganization).toHaveBeenCalledWith("acme");
	});

	it("does not duplicate organization lookups for matching forwarded and host headers", async () => {
		mockState.resolvePlatformOrganization.mockResolvedValue({ id: "org_123" });

		const response = await rejectUnsupportedPlatformHost(
			new Request("https://acme.ui.z8-time.app/api/auth/session", {
				headers: {
					host: "acme.ui.z8-time.app",
					"x-forwarded-host": "acme.ui.z8-time.app",
				},
			}),
		);

		expect(response).toBeNull();
		expect(mockState.resolvePlatformOrganization).toHaveBeenCalledOnce();
	});

	it.each(methods)(
		"exports %s through the platform host check",
		async (method) => {
			const request = new Request("https://ui.z8-time.app/api/auth/session", {
				method,
				headers: { host: "ui.z8-time.app" },
			});

			const response = await route[method](request);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({ method });
			expect(mockState.classifyDomainHost).toHaveBeenCalledWith(
				"ui.z8-time.app",
			);
			expect(mockState.handlers[method]).toHaveBeenCalledOnce();
			expect(mockState.handlers[method]).toHaveBeenCalledWith(request);
		},
	);

	it.each(methods)(
		"rejects unsupported hosts for %s without invoking Better Auth",
		async (method) => {
			mockState.resolvePlatformOrganization.mockResolvedValue(null);
			const request = new Request(
				"https://missing.ui.z8-time.app/api/auth/session",
				{
					method,
					headers: { host: "missing.ui.z8-time.app" },
				},
			);

			const response = await route[method](request);

			expect(response.status).toBe(404);
			await expect(response.json()).resolves.toEqual({ error: "Not found" });
			expect(mockState.handlers[method]).not.toHaveBeenCalled();
		},
	);
});
