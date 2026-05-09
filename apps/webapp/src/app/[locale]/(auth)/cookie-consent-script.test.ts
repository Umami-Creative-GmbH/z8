import { describe, expect, it } from "vitest";
import type { DomainAuthContext } from "@/lib/domain";
import { parseCookieConsentScript, selectAuthCookieConsentScript } from "./cookie-consent-script";

const domainContext = (cookieConsentScript?: string): DomainAuthContext => {
	const context: DomainAuthContext = {
		organizationId: "org_123",
		domain: "login.acme.test",
		authConfig: {
			emailPasswordEnabled: true,
			socialProvidersEnabled: [],
			ssoEnabled: false,
			passkeyEnabled: true,
			cookieConsentScript,
		},
		branding: null,
		socialOAuthConfigured: {
			google: false,
			github: false,
			linkedin: false,
			apple: false,
		},
		turnstile: {
			enabled: false,
			siteKey: null,
			isEnterprise: true,
		},
	};

	return context;
};

describe("selectAuthCookieConsentScript", () => {
	it("uses the platform script on the main auth domain", () => {
		expect(selectAuthCookieConsentScript(null, "<script>platform()</script>")).toBe(
			"<script>platform()</script>",
		);
	});

	it("uses the custom-domain script for verified custom domains", () => {
		expect(
			selectAuthCookieConsentScript(
				domainContext("<script>domain()</script>"),
				"<script>platform()</script>",
			),
		).toBe("<script>domain()</script>");
	});

	it("does not fall back to the platform script for custom domains", () => {
		expect(
			selectAuthCookieConsentScript(domainContext(undefined), "<script>platform()</script>"),
		).toBeNull();
	});

	it("treats whitespace custom-domain scripts as disabled", () => {
		expect(
			selectAuthCookieConsentScript(domainContext("   \n\t"), "<script>platform()</script>"),
		).toBeNull();
	});
});

describe("parseCookieConsentScript", () => {
	it("treats raw JavaScript as inline content", () => {
		expect(parseCookieConsentScript("window.cookieConsent = true;")).toEqual({
			content: "window.cookieConsent = true;",
		});
	});

	it("extracts inner content from an inline script tag", () => {
		expect(parseCookieConsentScript('<script id="consent">domain()</script>')).toEqual({
			id: "consent",
			content: "domain()",
		});
	});

	it("extracts src and useful attributes from an external script tag", () => {
		expect(
			parseCookieConsentScript(
				'<script id="Cookiebot" src="https://consent.example/uc.js" data-cbid="abc" type="text/javascript" async></script>',
			),
		).toEqual({
			id: "Cookiebot",
			src: "https://consent.example/uc.js",
			type: "text/javascript",
			async: true,
			"data-cbid": "abc",
		});
	});

	it("extracts external script tags surrounded by HTML comments", () => {
		expect(
			parseCookieConsentScript(`<!-- Example: CookieBot -->
<script id="Cookiebot" src="https://consent.example/uc.js" data-cbid="abc" async></script>`),
		).toEqual({
			id: "Cookiebot",
			src: "https://consent.example/uc.js",
			async: true,
			"data-cbid": "abc",
		});
	});
});
