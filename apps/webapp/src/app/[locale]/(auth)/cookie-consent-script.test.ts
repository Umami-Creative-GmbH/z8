import { describe, expect, it } from "vitest";
import type { DomainAuthContext } from "@/lib/domain";
import { selectAuthCookieConsentScript } from "./cookie-consent-script";

type DomainAuthContextWithCookieConsentScript = DomainAuthContext & {
	authConfig: DomainAuthContext["authConfig"] & {
		cookieConsentScript?: string | null;
	};
};

const domainContext = (cookieConsentScript?: string): DomainAuthContext => {
	const context: DomainAuthContextWithCookieConsentScript = {
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
		expect(selectAuthCookieConsentScript(domainContext(undefined), "<script>platform()</script>")).toBeNull();
	});

	it("treats whitespace custom-domain scripts as disabled", () => {
		expect(selectAuthCookieConsentScript(domainContext("   \n\t"), "<script>platform()</script>")).toBeNull();
	});
});
