import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: {
		APP_URL: undefined as string | undefined,
		BETTER_AUTH_URL: undefined as string | undefined,
		NEXT_PUBLIC_APP_URL: undefined as string | undefined,
		MAIN_DOMAIN: undefined as string | undefined,
		PLATFORM_DOMAIN: undefined as string | undefined,
	},
	configured: true,
	classifyDomainHost: vi.fn(),
	resolvePlatformOrganization: vi.fn(),
	getDomainConfig: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mocks.env }));
// next-intl's locale-prefix redirect resolves against request.url, like the proxy did.
vi.mock("next-intl/middleware", () => ({
	default: () => (request: NextRequest) =>
		/^\/[a-z]{2,3}(?:\/|$)/.test(request.nextUrl.pathname)
			? NextResponse.next()
			: NextResponse.redirect(
					new URL(
						`/de${request.nextUrl.pathname}${request.nextUrl.search}`,
						request.url,
					),
				),
}));
vi.mock("@/lib/setup/config-cache", () => ({
	isPlatformConfigured: async () => mocks.configured,
}));
vi.mock("@/lib/domain/platform-domain", () => ({
	classifyDomainHost: mocks.classifyDomainHost,
	resolvePlatformOrganization: mocks.resolvePlatformOrganization,
}));
vi.mock("@/lib/domain/domain-service", () => ({
	getDomainConfig: mocks.getDomainConfig,
}));
vi.mock("@/lib/rate-limit", () => ({
	checkRateLimit: async () => ({ allowed: true }),
	createRateLimitResponse: () => new Response(null, { status: 429 }),
	getClientIp: () => "203.0.113.1",
}));

import { proxy } from "./proxy";

const SESSION_COOKIE = "better-auth.session_token=session";

// Next 16 builds the proxy's request.url from x-forwarded-proto and its own
// listening address; only the Host header carries the public authority.
function listeningRequest(
	path: string,
	{ host, cookie }: { host?: string; cookie?: string } = {},
) {
	return new NextRequest(`https://localhost:3000${path}`, {
		headers: {
			...(host === undefined ? {} : { host }),
			...(cookie === undefined ? {} : { cookie }),
			"x-forwarded-host": "forwarded.attacker.test",
			"x-forwarded-proto": "https",
		},
	});
}

describe("proxy redirects use the public origin", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		for (const key of Object.keys(mocks.env) as (keyof typeof mocks.env)[]) {
			mocks.env[key] = undefined;
		}
		mocks.env.APP_URL = "https://z8.example.com";
		mocks.configured = true;
		mocks.classifyDomainHost.mockReturnValue(null);
		mocks.resolvePlatformOrganization.mockResolvedValue(null);
		mocks.getDomainConfig.mockResolvedValue(null);
	});

	it("redirects an unauthenticated page request to sign-in on the validated Host", async () => {
		const response = await proxy(
			listeningRequest("/de/time-tracking", { host: "z8.example.com" }),
		);
		expect(response.headers.get("location")).toBe(
			"https://z8.example.com/de/sign-in?callbackUrl=%2Ftime-tracking",
		);
	});

	it("redirects a signed-in auth route to the dashboard on the validated Host", async () => {
		const response = await proxy(
			listeningRequest("/de/sign-in", {
				host: "z8.example.com",
				cookie: SESSION_COOKIE,
			}),
		);
		expect(response.headers.get("location")).toBe("https://z8.example.com/de/");
	});

	it("redirects an unconfigured platform to setup on the validated Host", async () => {
		mocks.configured = false;
		const response = await proxy(
			listeningRequest("/de/time-tracking", { host: "z8.example.com" }),
		);
		expect(response.headers.get("location")).toBe(
			"https://z8.example.com/de/setup",
		);
	});

	it("redirects a configured platform's setup page home on the validated Host", async () => {
		const response = await proxy(
			listeningRequest("/de/setup", { host: "z8.example.com" }),
		);
		expect(response.headers.get("location")).toBe("https://z8.example.com/de/");
		expect(response.headers.get("cache-control")).toContain("no-store");
	});

	it("keeps locale-prefix redirects on the validated Host", async () => {
		const response = await proxy(
			listeningRequest("/time-tracking?view=week", { host: "z8.example.com" }),
		);
		const location = new URL(response.headers.get("location") ?? "");
		expect(location.origin).toBe("https://z8.example.com");
		expect(location.pathname).toBe("/de/time-tracking");
		expect(location.search).toBe("?view=week");
	});

	it("redirects a verified platform subdomain on its own host", async () => {
		mocks.env.PLATFORM_DOMAIN = "z8.example.com";
		mocks.classifyDomainHost.mockReturnValue({
			type: "platformOrganization",
			hostname: "acme.z8.example.com",
			label: "acme",
			rootDomain: "z8.example.com",
		});
		mocks.resolvePlatformOrganization.mockResolvedValue({ id: "org-acme" });
		const response = await proxy(
			listeningRequest("/de/time-tracking", { host: "acme.z8.example.com" }),
		);
		expect(response.headers.get("location")).toBe(
			"https://acme.z8.example.com/de/sign-in?callbackUrl=%2Ftime-tracking",
		);
		expect(mocks.resolvePlatformOrganization).toHaveBeenCalledWith("acme");
	});

	it("redirects a verified custom domain on its own host", async () => {
		mocks.classifyDomainHost.mockReturnValue({
			type: "customDomain",
			hostname: "time.customer.test",
		});
		mocks.getDomainConfig.mockResolvedValue({ organizationId: "org-1" });
		const response = await proxy(
			listeningRequest("/de/time-tracking", { host: "time.customer.test" }),
		);
		expect(response.headers.get("location")).toBe(
			"https://time.customer.test/de/sign-in?callbackUrl=%2Ftime-tracking",
		);
		expect(mocks.getDomainConfig).toHaveBeenCalledWith("time.customer.test");
	});

	it.each([
		["an unverified Host", "unverified.example.org"],
		["the listening Host", "localhost:3000"],
		["a missing Host", undefined],
	])("falls back to the configured origin for %s", async (_label, host) => {
		const response = await proxy(
			listeningRequest("/de/time-tracking", { host }),
		);
		expect(response.headers.get("location")).toBe(
			"https://z8.example.com/de/sign-in?callbackUrl=%2Ftime-tracking",
		);
	});

	it("falls back to the first configured origin in precedence order", async () => {
		mocks.env.APP_URL = undefined;
		mocks.env.BETTER_AUTH_URL = "https://auth.example.com";
		mocks.env.PLATFORM_DOMAIN = "platform.example.com";
		const response = await proxy(
			listeningRequest("/de/sign-in", {
				host: "unverified.example.org",
				cookie: SESSION_COOKIE,
			}),
		);
		expect(response.headers.get("location")).toBe(
			"https://auth.example.com/de/",
		);
	});

	it("falls back to the platform domain when it is the only configuration", async () => {
		mocks.env.APP_URL = undefined;
		mocks.env.PLATFORM_DOMAIN = "platform.example.com";
		const response = await proxy(
			listeningRequest("/de/time-tracking", { host: "unverified.example.org" }),
		);
		expect(response.headers.get("location")).toBe(
			"https://platform.example.com/de/sign-in?callbackUrl=%2Ftime-tracking",
		);
	});

	it("uses the request URL only when no public origin is configured", async () => {
		mocks.env.APP_URL = undefined;
		const response = await proxy(
			new NextRequest("http://localhost:4123/de/time-tracking", {
				headers: { host: "localhost:4123" },
			}),
		);
		expect(response.headers.get("location")).toBe(
			"http://localhost:4123/de/sign-in?callbackUrl=%2Ftime-tracking",
		);
	});
});
