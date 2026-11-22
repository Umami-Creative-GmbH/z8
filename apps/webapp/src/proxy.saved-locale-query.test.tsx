import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedAppContent } from "@/app/[locale]/(app)/app-layout-content";
import { DOMAIN_HEADERS, proxy } from "./proxy";

const h = vi.hoisted(() => ({
	headers: new Headers(),
	savedLocale: "en" as string | null,
}));
vi.mock("@/navigation", () => ({ Link: ({ children }: { children: unknown }) => children }));
vi.mock("next/headers", () => ({ headers: async () => h.headers }));
vi.mock("next/server", async (original) => ({
	...(await original<typeof import("next/server")>()),
	connection: async () => {},
}));
vi.mock("next/navigation", () => ({
	redirect: (target: string) => {
		throw Error(`TEST_REDIRECT:${target}`);
	},
}));
vi.mock("@/lib/setup/config-cache", () => ({ isPlatformConfigured: async () => true }));
vi.mock("@/lib/domain/platform-domain", async (original) => ({
	...(await original<typeof import("@/lib/domain/platform-domain")>()),
	classifyDomainHost: () => null,
	resolvePlatformOrganization: vi.fn(),
}));
vi.mock("@/lib/auth/render-session", () => ({
	getRenderSession: async () => ({
		user: { id: "query-user" },
		session: { activeOrganizationId: "query-org" },
	}),
}));
vi.mock("@/lib/auth/render-context", () => ({
	getRenderApprovedMembership: vi.fn(),
	getRenderOrganizationDisplayContext: async () => ({
		userId: "query-user",
		organizationId: "query-org",
		employee: null,
		organizationSettings: null,
		updatedAt: 0,
	}),
}));
vi.mock("@/lib/user-preferences/render-snapshot", () => ({
	getRenderUserPreferences: async () => ({
		locale: h.savedLocale,
		weekStartDay: "monday",
		timeFormat: "24h",
		timezone: "UTC",
		helpImproveProduct: false,
	}),
}));
vi.mock("@/env", async (original) => ({
	env: { ...(await original<typeof import("@/env")>()).env, BILLING_ENABLED: "false" },
}));

// Apply the public request-override protocol and ordinary response-header
// forwarding used by the pinned Next proxy resolver. No query is invented here.
async function throughProxy(path: string, inputHeaders: Record<string, string> = {}) {
	const request = new NextRequest(`https://app.example.test${path}`, {
		headers: { cookie: "better-auth.session_token=test-session", ...inputHeaders },
	});
	const response = await proxy(request);
	const forwarded = new Headers(request.headers);
	const overrideList = response.headers.get("x-middleware-override-headers");
	if (overrideList !== null) {
		const names = overrideList
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
		for (const name of [...forwarded.keys()]) if (!names.includes(name)) forwarded.delete(name);
		for (const name of names) {
			const value = response.headers.get(`x-middleware-request-${name}`);
			if (value === null) forwarded.delete(name);
			else forwarded.set(name, value);
		}
	}
	for (const [name, value] of response.headers)
		if (!name.startsWith("x-middleware-") && name !== "set-cookie") forwarded.set(name, value);
	h.headers = forwarded;
	return { request, response, forwarded };
}
beforeEach(() => {
	h.savedLocale = "en";
	h.headers = new Headers();
});
describe("proxy and saved-locale layout query preservation", () => {
	it("preserves repeated query values while enforcing the saved language", async () => {
		await throughProxy("/de/settings/enterprise/api-keys?tab=keys&keep=one&keep=two");
		await expect(
			AuthenticatedAppContent({ params: Promise.resolve({ locale: "de" }), children: null }),
		).rejects.toThrow("TEST_REDIRECT:/en/settings/enterprise/api-keys?tab=keys&keep=one&keep=two");
	});
	it.each([null, "de"])("respects a matching or unset saved preference %j", async (saved) => {
		h.savedLocale = saved;
		const { forwarded } = await throughProxy("/de/settings/enterprise/api-keys?keep=one&keep=two");
		await expect(
			AuthenticatedAppContent({ params: Promise.resolve({ locale: "de" }), children: null }),
		).resolves.toBeTruthy();
		expect(forwarded.get(DOMAIN_HEADERS.PATHNAME)).toBe("/de/settings/enterprise/api-keys");
		expect(new URLSearchParams(forwarded.get(DOMAIN_HEADERS.SEARCH) ?? "").getAll("keep")).toEqual([
			"one",
			"two",
		]);
	});
	it("retains empty, repeated and encoded values without reserialization", async () => {
		const search = "?keep=&keep=two&encoded=%2Fwork%3Fa%3D1%26b%3D2&space=one+two";
		await throughProxy(`/de/settings/enterprise/api-keys${search}`);
		await expect(
			AuthenticatedAppContent({ params: Promise.resolve({ locale: "de" }), children: null }),
		).rejects.toThrow(`TEST_REDIRECT:/en/settings/enterprise/api-keys${search}`);
	});
	it("overwrites a client-supplied query header and keeps intl/session context private", async () => {
		const { response, forwarded } = await throughProxy(
			"/de/settings/enterprise/api-keys?keep=real",
			{
				[DOMAIN_HEADERS.SEARCH]: "?keep=forged",
				"x-client-marker": "preserved",
			},
		);
		expect(forwarded.get(DOMAIN_HEADERS.SEARCH)).toBe("?keep=real");
		expect(forwarded.get("x-next-intl-locale")).toBe("de");
		expect(forwarded.get("cookie")).toContain("better-auth.session_token=test-session");
		expect(forwarded.get("x-client-marker")).toBe("preserved");
		expect(response.headers.get(DOMAIN_HEADERS.SEARCH)).toBeNull();
		expect(response.cookies.get("NEXT_LOCALE")?.value).toBe("de");
		expect(response.headers.get("x-middleware-rewrite")).toBeNull();
		await expect(
			AuthenticatedAppContent({ params: Promise.resolve({ locale: "de" }), children: null }),
		).rejects.toThrow("TEST_REDIRECT:/en/settings/enterprise/api-keys?keep=real");
	});
	it("clears forged query context when the real URL has no query", async () => {
		const { forwarded } = await throughProxy("/de/settings/enterprise/api-keys", {
			[DOMAIN_HEADERS.SEARCH]: "?unexpected=one",
		});
		expect(forwarded.get(DOMAIN_HEADERS.SEARCH)).toBe("");
		await expect(
			AuthenticatedAppContent({ params: Promise.resolve({ locale: "de" }), children: null }),
		).rejects.toThrow("TEST_REDIRECT:/en/settings/enterprise/api-keys");
	});
	it("preserves the three-letter route locale and pathname-only callbacks", async () => {
		const { forwarded } = await throughProxy("/gsw/settings/billing?return=one&return=two");
		expect(forwarded.get(DOMAIN_HEADERS.PATHNAME)).toBe("/gsw/settings/billing");
		await expect(
			AuthenticatedAppContent({ params: Promise.resolve({ locale: "gsw" }), children: null }),
		).rejects.toThrow("TEST_REDIRECT:/en/settings/billing?return=one&return=two");
	});
	it("keeps API early-return handling free of page query forwarding", async () => {
		const { response } = await throughProxy("/api/time-entries?keep=one");
		expect(response.headers.get("x-middleware-override-headers")).toBeNull();
		expect(response.headers.get(`x-middleware-request-${DOMAIN_HEADERS.SEARCH}`)).toBeNull();
	});
});
