import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: { APP_URL: "https://z8.example.com" },
	getDomainConfig: vi.fn(),
	resolvePlatformOrganization: vi.fn(),
	signInSSO: vi.fn(),
	membership: vi.fn(),
}));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/lib/domain/domain-service", () => ({
	getDomainConfig: mocks.getDomainConfig,
}));
vi.mock("@/lib/domain/platform-domain", () => ({
	resolvePlatformOrganization: mocks.resolvePlatformOrganization,
}));
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: "actor" },
				session: { id: "session", userId: "actor" },
			}),
			signInSSO: mocks.signInSSO,
		},
	},
}));
vi.mock("@/db", () => ({
	db: { query: { member: { findFirst: mocks.membership } } },
}));
vi.mock("@/lib/enterprise-identity/session-sso-store", () => ({
	sessionSsoStore: {
		getPolicy: async () => ({ required: true, providerId: "idp" }),
	},
}));

import { POST } from "./route";

function request(host: string) {
	return new Request("https://0.0.0.0:3000/api/organizations/sso", {
		method: "POST",
		headers: {
			host,
			"content-type": "application/json",
			"x-forwarded-host": "evil.example",
		},
		body: JSON.stringify({ organizationId: "locked", callbackUrl: "/reports" }),
	});
}

describe("SSO reauthentication public origin", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.env.APP_URL = "https://z8.example.com";
		mocks.getDomainConfig.mockResolvedValue(null);
		mocks.resolvePlatformOrganization.mockResolvedValue(null);
		mocks.membership.mockResolvedValue({ id: "membership" });
		mocks.signInSSO.mockImplementation(async () =>
			Response.json(
				{ url: "https://idp.example/login" },
				{
					headers: { "set-cookie": "oauth_state=signed; HttpOnly" },
				},
			),
		);
	});

	it.each([
		["https://z8.example.com", "z8.example.com"],
		["http://localhost:4310", "localhost:4310"],
	])(
		"uses configured public origin %s for both callbacks and retains state cookies",
		async (origin, host) => {
			mocks.env.APP_URL = origin;
			const response = await POST(request(host));
			expect(response.status).toBe(200);
			expect(response.headers.get("set-cookie")).toContain(
				"oauth_state=signed",
			);
			const { body } = mocks.signInSSO.mock.calls[0][0];
			for (const callback of [body.callbackURL, body.errorCallbackURL]) {
				const url = new URL(callback);
				expect(url.origin).toBe(origin);
				expect(url.pathname).toBe("/init");
				expect(url.searchParams.get("organizationId")).toBe("locked");
				expect(url.searchParams.get("callbackUrl")).toBe("/reports");
			}
		},
	);

	it.each([
		"evil.example",
		"https://z8.example.com",
		"z8.example.com@evil.example",
	])(
		"rejects malformed/unverified Host %s before starting SSO",
		async (host) => {
			const response = await POST(request(host));
			expect(response.status).toBe(403);
			expect(mocks.signInSSO).not.toHaveBeenCalled();
			expect(response.headers.get("location")).toBeNull();
			expect(await response.json()).toEqual({
				error:
					"SSO sign-in could not be started. Try again or contact your organization administrator.",
			});
		},
	);
});
