import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	classifyDomainHost: vi.fn(),
	resolvePlatformOrganization: vi.fn(),
}));

vi.mock("better-auth/next-js", () => ({
	toNextJsHandler: vi.fn(() => ({
		GET: vi.fn(() => Response.json({ ok: true })),
		POST: vi.fn(() => Response.json({ ok: true })),
	})),
}));

vi.mock("@/lib/auth", () => ({ auth: {} }));

vi.mock("@/lib/domain", () => ({
	classifyDomainHost: mockState.classifyDomainHost,
	resolvePlatformOrganization: mockState.resolvePlatformOrganization,
}));

const { rejectUnsupportedPlatformHost } = await import("./route");

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
		expect(mockState.resolvePlatformOrganization).toHaveBeenCalledWith("missing");
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
});
