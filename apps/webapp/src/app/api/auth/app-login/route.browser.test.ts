import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: { APP_URL: "https://public.example.test" as string | undefined },
	getSession: vi.fn(),
	getDomainConfig: vi.fn(),
	createAppAuthCode: vi.fn(),
}));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/auth/app-auth-code", () => ({
	createAppAuthCode: mocks.createAppAuthCode,
}));
vi.mock("@/lib/domain/domain-service", () => ({
	getDomainConfig: mocks.getDomainConfig,
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));
vi.mock("@/lib/rate-limit", () => ({
	getClientIp: () => "192.0.2.1",
	checkRateLimit: async () => ({ allowed: true }),
}));

const appLogin = await import("./route");
const desktopLogin = await import("../desktop-login/route");

function request(
	path: string,
	host = "public.example.test",
	accept = "text/html",
) {
	const url = new URL(`/api/auth/${path}`, "https://localhost:3000");
	url.searchParams.set("app", "desktop");
	url.searchParams.set("redirect", "z8://auth/callback?source=fixture");
	url.searchParams.set("challenge", "A".repeat(43));
	return new NextRequest(url, {
		headers: {
			host,
			accept,
			"x-forwarded-host": "attacker.example",
			"x-forwarded-proto": "http",
		},
	});
}

describe.each([
	["app-login", appLogin.GET],
	["desktop-login", desktopLogin.GET],
] as const)("browser desktop sign-in through %s", (path, handler) => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.env.APP_URL = "https://public.example.test";
		mocks.getSession.mockResolvedValue(null);
		mocks.getDomainConfig.mockResolvedValue(null);
		mocks.createAppAuthCode.mockResolvedValue({ code: "FIXTURE-AUTH-CODE" });
	});

	it.each(["public.example.test", "localhost:3000", "attacker.example"])(
		"keeps sign-in and its return URL on the configured origin for Host %s",
		async (host) => {
			const input = request(path, host);
			const response = await handler(input);
			expect(response.status).toBe(307);
			const signIn = new URL(response.headers.get("location") ?? "");
			expect(signIn.origin).toBe("https://public.example.test");
			expect(signIn.pathname).toBe("/sign-in");
			const callback = new URL(signIn.searchParams.get("callbackUrl") ?? "");
			expect(callback.origin).toBe(signIn.origin);
			expect(callback.pathname).toBe(`/api/auth/${path}`);
			expect(callback.search).toBe(input.nextUrl.search);
			expect(mocks.createAppAuthCode).not.toHaveBeenCalled();
		},
	);

	it("keeps a verified customer domain for both browser destinations", async () => {
		mocks.getDomainConfig.mockResolvedValue({ organizationId: "fixture-org" });
		const response = await handler(request(path, "tenant.example.test"));
		const signIn = new URL(response.headers.get("location") ?? "");
		expect(signIn.origin).toBe("https://tenant.example.test");
		expect(new URL(signIn.searchParams.get("callbackUrl") ?? "").origin).toBe(
			signIn.origin,
		);
	});

	it("keeps local development on its configured origin", async () => {
		mocks.env.APP_URL = "http://localhost:4310";
		const response = await handler(request(path, "localhost:4310"));
		expect(new URL(response.headers.get("location") ?? "").origin).toBe(
			"http://localhost:4310",
		);
	});

	it("returns a browser handoff with automatic launch and a clickable fallback", async () => {
		mocks.getSession.mockResolvedValue({
			user: { id: "fixture-user" },
			session: { token: "FIXTURE-SESSION-SECRET" },
		});
		const response = await handler(request(path));
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(response.headers.has("location")).toBe(false);
		const html = await response.text();
		expect(html).toContain('id="open-z8"');
		expect(html).toContain(
			"z8://auth/callback?source=fixture&amp;code=FIXTURE-AUTH-CODE",
		);
		expect(html).toContain("location.assign");
		expect(html).not.toContain("FIXTURE-SESSION-SECRET");
		expect(mocks.createAppAuthCode).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				app: "desktop",
				codeChallenge: "A".repeat(43),
			}),
		);
		expect(response.headers.get("cache-control")).toContain("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		expect(response.headers.get("content-security-policy")).toContain(
			"default-src 'none'",
		);
	});

	it("preserves the protocol redirect for clients that do not accept HTML", async () => {
		mocks.getSession.mockResolvedValue({
			user: { id: "fixture-user" },
			session: { token: "FIXTURE-SESSION-SECRET" },
		});
		const response = await handler(
			request(path, "public.example.test", "application/json"),
		);
		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe(
			"z8://auth/callback?source=fixture&code=FIXTURE-AUTH-CODE",
		);
		expect(response.headers.get("cache-control")).toContain("no-store");
	});
});
