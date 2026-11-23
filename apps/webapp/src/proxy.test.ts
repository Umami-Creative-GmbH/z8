import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
	default: vi.fn(() => () => NextResponse.next()),
}));
const platform = vi.hoisted(() => ({ configured: false }));
vi.mock("@/lib/setup/config-cache", () => ({
	isPlatformConfigured: async () => platform.configured,
}));
vi.mock("@/lib/domain/platform-domain", () => ({
	classifyDomainHost: vi.fn(() => null),
	resolvePlatformOrganization: vi.fn(),
}));
vi.mock("@/lib/domain/domain-service", () => ({
	getDomainConfig: vi.fn(async () => null),
}));

import { NextRequest, NextResponse } from "next/server";
import { classifyDomainHost, resolvePlatformOrganization } from "@/lib/domain/platform-domain";
import { config, proxy } from "./proxy";

function matchesProxy(pathname: string) {
	return config.matcher.some((matcher) => new RegExp(`^${matcher}$`).test(pathname));
}

describe("proxy matcher", () => {
	it("rewrites setup code requests directly to the cookie exchange without rendering the secret URL", async () => {
		const response = await proxy(
			new NextRequest("https://app.example.com/de/setup?code=operator-secret"),
		);
		expect(response.headers.get("x-middleware-rewrite")).toBe(
			"https://app.example.com/api/setup/authorize?code=operator-secret&locale=de",
		);
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		expect(response.headers.get("cache-control")).toContain("no-store");
	});
	it("preserves the three-letter Swiss German setup locale", async () => {
		const response = await proxy(
			new NextRequest("https://app.example.com/gsw/setup?code=operator-secret"),
		);
		expect(response.headers.get("x-middleware-rewrite")).toBe(
			"https://app.example.com/api/setup/authorize?code=operator-secret&locale=gsw",
		);
	});
	it.each(["/setup", "/de/setup", "/gsw/setup"])(
		"keeps clean setup pages public and non-cacheable: %s",
		async (path) => {
			const response = await proxy(new NextRequest(`https://app.example.com${path}`));
			expect(response.headers.get("location")).toBeNull();
			expect(response.headers.get("referrer-policy")).toBe("no-referrer");
			expect(response.headers.get("cache-control")).toContain("no-store");
		},
	);

	it.each(["/en/kiosk", "/de/kiosk?code=ABCDE-FGHJK"])(
		"opens the kiosk page without a user session: %s",
		async (path) => {
			platform.configured = true;
			try {
				const response = await proxy(new NextRequest(`https://app.example.com${path}`));
				expect(response.headers.get("location")).toBeNull();
			} finally {
				platform.configured = false;
			}
		},
	);

	describe("camera permission (#1367)", () => {
		const policy = async (path: string, cookie?: string) => {
			platform.configured = true;
			try {
				const response = await proxy(
					new NextRequest(`https://app.example.com${path}`, cookie ? { headers: { cookie } } : {}),
				);
				expect(response.headers.get("location")).toBeNull();
				return response.headers.get("permissions-policy");
			} finally {
				platform.configured = false;
			}
		};

		it.each(["/en/kiosk", "/de/kiosk?code=ABCDE-FGHJK", "/gsw/kiosk", "/uk/kiosk"])(
			"lets the kiosk page %s use the camera, never the microphone",
			async (path) => {
				expect(await policy(path)).toBe("camera=(self), microphone=(), geolocation=(self)");
			},
		);

		it.each(["/en/sign-in", "/gsw/sign-in", "/en/licenses"])(
			"keeps the camera blocked on the public page %s",
			async (path) => {
				expect(await policy(path)).toBe("camera=(), microphone=(), geolocation=(self)");
			},
		);

		it.each([
			"/en/settings/kiosks",
			"/de/time-tracking",
			"/gsw/settings/employees",
			"/en/kiosk-board",
		])("keeps the camera blocked on the signed-in page %s", async (path) => {
			expect(await policy(path, "better-auth.session_token=session")).toBe(
				"camera=(), microphone=(), geolocation=(self)",
			);
		});
	});

	it("does not locale-prefix PostHog ingest proxy requests", () => {
		expect(matchesProxy("/ingest/flags")).toBe(false);
		expect(matchesProxy("/ingest/static/array.js")).toBe(false);
	});

	it("covers API routes", () => {
		expect(matchesProxy("/api/time-entries")).toBe(true);
		expect(matchesProxy("/api/auth/app-exchange")).toBe(true);
	});

	it("passes API requests to route handlers without page middleware", async () => {
		const response = await proxy(
			new NextRequest("https://app.example.com/api/time-entries", {
				headers: { authorization: "Bearer session-token" },
			}),
		);
		expect(response.headers.get("x-middleware-next")).toBe("1");
		expect(response.headers.get("location")).toBeNull();
	});

	it("passes the in-cluster custom-domain poll through untouched", async () => {
		vi.clearAllMocks();
		const host = "web.app-prod.svc.cluster.local:3000";
		const path = "/api/internal/custom-domains";
		expect(matchesProxy(path)).toBe(true);
		const response = await proxy(
			new NextRequest(`http://${host}${path}`, {
				headers: { host, authorization: "Bearer test-secret", accept: "application/json" },
			}),
		);
		expect(response.status).toBe(200);
		expect([...response.headers]).toEqual([["x-middleware-next", "1"]]);
		expect(classifyDomainHost).not.toHaveBeenCalled();
		expect(resolvePlatformOrganization).not.toHaveBeenCalled();
	});
});

describe("legacy settings 308 redirects (#1963)", () => {
	const LEGACY_REDIRECT_CASES = [
		["/settings/organizations", "/settings/organization", null],
		["/settings/audit-log", "/settings/audit-export", "activity"],
		["/settings/enterprise/audit-log", "/settings/audit-export", "activity"],
		["/settings/enterprise", "/settings/enterprise/domains", null],
		["/settings/enterprise/sso", "/settings/enterprise/identity-setup", "sso"],
		["/settings/enterprise/branding", "/settings/enterprise/domains", "branding"],
		["/settings/discord", "/settings/notification-channels", "discord"],
		["/settings/slack", "/settings/notification-channels", "slack"],
		["/settings/telegram", "/settings/notification-channels", "telegram"],
		["/settings/teams-notifications", "/settings/notification-channels", "teams"],
		["/settings/email-templates", "/settings/enterprise/email", "templates"],
		["/settings/webhooks", "/settings/enterprise/api-keys", "webhooks"],
		["/settings/vehicle-use", "/settings/vehicles", "use"],
		["/settings/clockodo-import", "/settings/import", null],
		["/settings/holidays", "/settings/vacation", "holidays"],
		["/settings/change-policies", "/settings/work-policies", "changes"],
		["/settings/coverage-rules", "/settings/shifts", "coverage"],
		["/settings/approval-escalation", "/settings/approval-policies", "escalation"],
		["/settings/employees/new", "/settings/employees", null],
		["/settings/permissions", "/settings/roles", "team-permissions"],
	] as const;

	it.each(LEGACY_REDIRECT_CASES)(
		"redirects locale-prefixed %s to %s with 308",
		async (legacyPath, canonicalPath, expectedTab) => {
			platform.configured = true;
			try {
				for (const locale of ["en", "de", "gsw"] as const) {
					const response = await proxy(
						new NextRequest(`https://app.example.com/${locale}${legacyPath}`),
					);
					expect(response.status).toBe(308);
					const location = new URL(response.headers.get("location") ?? "");
					expect(location.pathname).toBe(`/${locale}${canonicalPath}`);
					expect(location.searchParams.get("tab")).toBe(expectedTab);
				}
			} finally {
				platform.configured = false;
			}
		},
	);

	it.each(LEGACY_REDIRECT_CASES)(
		"redirects bare %s without locale prefix to default locale %s with 308",
		async (legacyPath, canonicalPath, expectedTab) => {
			platform.configured = true;
			try {
				const response = await proxy(new NextRequest(`https://app.example.com${legacyPath}`));
				expect(response.status).toBe(308);
				const location = new URL(response.headers.get("location") ?? "");
				expect(location.pathname).toBe(`/en${canonicalPath}`);
				expect(location.searchParams.get("tab")).toBe(expectedTab);
			} finally {
				platform.configured = false;
			}
		},
	);

	it("resolves bare legacy URLs using NEXT_LOCALE cookie or Accept-Language", async () => {
		platform.configured = true;
		try {
			const fromCookie = await proxy(
				new NextRequest("https://app.example.com/settings/webhooks", {
					headers: { cookie: "NEXT_LOCALE=de", "accept-language": "fr-FR,fr;q=0.9" },
				}),
			);
			expect(fromCookie.status).toBe(308);
			expect(fromCookie.headers.get("location")).toBe(
				"https://app.example.com/de/settings/enterprise/api-keys?tab=webhooks",
			);

			const fromAcceptLanguage = await proxy(
				new NextRequest("https://app.example.com/settings/permissions", {
					headers: { "accept-language": "fr-CH,fr;q=0.9,en;q=0.8" },
				}),
			);
			expect(fromAcceptLanguage.status).toBe(308);
			expect(fromAcceptLanguage.headers.get("location")).toBe(
				"https://app.example.com/fr/settings/roles?tab=team-permissions",
			);
		} finally {
			platform.configured = false;
		}
	});

	it("preserves existing query parameters and repeated values while applying the target tab", async () => {
		platform.configured = true;
		try {
			const withTab = await proxy(
				new NextRequest(
					"https://app.example.com/de/settings/webhooks?tab=keys&filter=active&tag=one&tag=two&highlight=wh_1",
				),
			);
			expect(withTab.status).toBe(308);
			const location = new URL(withTab.headers.get("location") ?? "");
			expect(location.pathname).toBe("/de/settings/enterprise/api-keys");
			expect(location.searchParams.get("tab")).toBe("webhooks");
			expect(location.searchParams.get("filter")).toBe("active");
			expect(location.searchParams.get("highlight")).toBe("wh_1");
			expect(location.searchParams.getAll("tag")).toEqual(["one", "two"]);

			const withoutTargetTab = await proxy(
				new NextRequest("https://app.example.com/de/settings/organizations?from=email&highlight=1"),
			);
			expect(withoutTargetTab.status).toBe(308);
			const orgLocation = new URL(withoutTargetTab.headers.get("location") ?? "");
			expect(orgLocation.pathname).toBe("/de/settings/organization");
			expect(orgLocation.searchParams.get("from")).toBe("email");
			expect(orgLocation.searchParams.get("highlight")).toBe("1");
			expect(orgLocation.searchParams.get("tab")).toBeNull();
		} finally {
			platform.configured = false;
		}
	});

	it("redirects the retired /approvals workspace to the Approval inbox with 308, keeping the query (#1976)", async () => {
		platform.configured = true;
		try {
			const response = await proxy(
				new NextRequest(
					"https://app.example.com/de/approvals?types=absence_entry&types=time_entry&q=x",
				),
			);
			expect(response.status).toBe(308);
			const location = new URL(response.headers.get("location") ?? "");
			expect(location.pathname).toBe("/de/approvals/inbox");
			expect(location.searchParams.getAll("types")).toEqual(["absence_entry", "time_entry"]);
			expect(location.searchParams.get("q")).toBe("x");
			expect(location.searchParams.get("tab")).toBeNull();

			const bare = await proxy(new NextRequest("https://app.example.com/approvals/"));
			expect(bare.status).toBe(308);
			expect(new URL(bare.headers.get("location") ?? "").pathname).toBe("/en/approvals/inbox");

			const inbox = await proxy(new NextRequest("https://app.example.com/de/approvals/inbox"));
			expect(inbox.status).not.toBe(308);
		} finally {
			platform.configured = false;
		}
	});

	it("handles trailing slashes without hijacking canonical sibling or child routes", async () => {
		platform.configured = true;
		try {
			const trailingEnterprise = await proxy(
				new NextRequest("https://app.example.com/de/settings/enterprise/"),
			);
			expect(trailingEnterprise.status).toBe(308);
			expect(trailingEnterprise.headers.get("location")).toBe(
				"https://app.example.com/de/settings/enterprise/domains",
			);

			const trailingPermissions = await proxy(
				new NextRequest("https://app.example.com/settings/permissions/"),
			);
			expect(trailingPermissions.status).toBe(308);
			expect(trailingPermissions.headers.get("location")).toBe(
				"https://app.example.com/en/settings/roles?tab=team-permissions",
			);

			for (const canonicalPath of [
				"/de/settings/enterprise/api-keys",
				"/de/settings/enterprise/api-keys/key-123",
				"/de/settings/enterprise/domains",
				"/de/settings/enterprise/email",
				"/de/settings/enterprise/identity-setup",
				"/de/settings/employees/emp-123",
				"/de/settings/organization",
				"/de/settings/roles",
			]) {
				const response = await proxy(
					new NextRequest(`https://app.example.com${canonicalPath}`, {
						headers: { cookie: "better-auth.session_token=session" },
					}),
				);
				expect(response.status, canonicalPath).not.toBe(308);
				expect(response.headers.get("location"), canonicalPath).toBeNull();
			}
		} finally {
			platform.configured = false;
		}
	});
});
