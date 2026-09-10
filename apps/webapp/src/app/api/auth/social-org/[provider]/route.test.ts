import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-url", () => ({
	getBaseUrlFromHost: () => "https://app.example.com",
}));
vi.mock("@/lib/domain", () => ({
	classifyDomainHost: () => null,
	getDomainConfig: async () => null,
	getPlatformOrganizationLabel: () => null,
	resolvePlatformOrganization: async () => null,
}));
vi.mock("@/lib/social-oauth", () => ({
	buildAuthorizationUrl: () => "https://provider.example/authorize",
	createOAuthState: (state: unknown) => state,
	generateCodeVerifier: () => "verifier",
	generateNonce: () => "nonce",
	resolveCredentials: async () => ({ credentials: {}, isOrgSpecific: false }),
	STATE_COOKIE_MAX_AGE: 600,
	STATE_COOKIE_NAME: "z8_social_oauth_state",
}));

import { GET } from "./route";

describe("social oauth initiation callback validation", () => {
	it.each([
		["/\\evil.example/", "/"],
		["/\t/evil.example/", "/"],
		["//evil.example/", "/"],
		["/safe/..//evil.example/", "/"],
		["https://evil.example/", "/"],
		["/settings?tab=security#sessions", "/settings?tab=security#sessions"],
	])("stores only a safe callback in OAuth state for %j", async (callbackURL, expected) => {
		const url = new URL("https://app.example.com/api/auth/social-org/google");
		url.searchParams.set("callbackURL", callbackURL);
		const response = await GET(new NextRequest(url), {
			params: Promise.resolve({ provider: "google" }),
		});
		const state = JSON.parse(response.cookies.get("z8_social_oauth_state")!.value);
		expect(state.callbackURL).toBe(expected);
	});
});
