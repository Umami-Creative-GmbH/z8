import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
	default: vi.fn(() => () => NextResponse.redirect("https://app.example.com/en/elsewhere")),
}));
vi.mock("@/lib/setup/config-cache", () => ({
	isPlatformConfigured: async () => true,
}));
vi.mock("@/lib/domain/platform-domain", () => ({
	classifyDomainHost: () => null,
	resolvePlatformOrganization: vi.fn(),
}));
const share = vi.hoisted(() => ({
	creatorLocale: vi.fn(async (_token: string): Promise<string | null> => null),
	limited: new Set<string>(),
	checked: [] as { identifier: string; endpoint: string }[],
}));
vi.mock("@/lib/projects/report-share/creator-locale", () => ({
	shareLinkCreatorLocaleForToken: share.creatorLocale,
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/rate-limit")>()),
	checkRateLimit: vi.fn(async (identifier: string, endpoint: string) => {
		share.checked.push({ identifier, endpoint });
		const allowed = !share.limited.has(endpoint);
		return { allowed, remaining: allowed ? 1 : 0, resetAt: Date.now() + 60_000, retryAfter: 60 };
	}),
}));

import { NextRequest, NextResponse } from "next/server";
import { proxy } from "./proxy";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde";

function open(path: string, headers: Record<string, string> = {}) {
	return proxy(
		new NextRequest(`https://app.example.com${path}`, {
			headers: { "x-forwarded-for": "203.0.113.7", ...headers },
		}),
	);
}

function expectPrivate(response: Response) {
	expect(response.headers.get("cache-control")).toContain("no-store");
	expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	expect(response.headers.get("x-robots-tag")).toContain("noindex");
}

describe("report share link pages in the proxy", () => {
	beforeEach(() => {
		share.creatorLocale.mockReset();
		share.creatorLocale.mockResolvedValue(null);
		share.limited.clear();
		share.checked = [];
	});

	it("serves a share link without a session, in the recipient's browser language, without a redirect", async () => {
		const response = await open(`/share/${TOKEN}`, {
			"accept-language": "ja;q=1, fr-CH;q=0.9, en;q=0.5",
		});

		expect(response.headers.get("location")).toBeNull();
		expect(response.headers.get("x-middleware-rewrite")).toBe(
			`https://app.example.com/fr/share/${TOKEN}`,
		);
		expectPrivate(response);
		expect(share.creatorLocale).not.toHaveBeenCalled();
	});

	it("falls back to the creator's language when Z8 lacks the browser's", async () => {
		share.creatorLocale.mockResolvedValue("de");

		const response = await open(`/share/${TOKEN}`, { "accept-language": "ja, zh;q=0.8" });

		expect(response.headers.get("x-middleware-rewrite")).toBe(
			`https://app.example.com/de/share/${TOKEN}`,
		);
		expect(share.creatorLocale).toHaveBeenCalledWith(TOKEN);
	});

	it("falls back to English for a token it cannot find, the same as for any other", async () => {
		const response = await open("/share/not-a-real-token");

		expect(response.headers.get("x-middleware-rewrite")).toBe(
			"https://app.example.com/en/share/not-a-real-token",
		);
		expectPrivate(response);
	});

	it("keeps an explicit language prefix and stays public", async () => {
		const response = await open(`/gsw/share/${TOKEN}`);

		expect(response.headers.get("location")).toBeNull();
		expect(response.headers.get("x-middleware-rewrite")).toBeNull();
		expectPrivate(response);
	});

	it("rate-limits per client IP and per token, never keying Redis by the token itself", async () => {
		await open(`/share/${TOKEN}`, { "accept-language": "en" });

		expect(share.checked).toEqual([
			{ identifier: "203.0.113.7", endpoint: "reportShare" },
			{
				identifier: expect.stringMatching(/^report-share:[0-9a-f]{64}$/),
				endpoint: "reportShareToken",
			},
		]);

		share.limited.add("reportShareToken");
		const limited = await open(`/share/${TOKEN}`, { "accept-language": "en" });
		expect(limited.status).toBe(429);
		expectPrivate(limited);

		share.limited.clear();
		share.limited.add("reportShare");
		expect((await open("/share/guess")).status).toBe(429);
	});
});
