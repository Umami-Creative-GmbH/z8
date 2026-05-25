/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthLayout from "./layout";

const mockState = vi.hoisted(() => ({
	headers: vi.fn(async () => new Headers()),
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
	classifyDomainHost: vi.fn(),
	getCookieConsentScript: vi.fn(async () => null),
	getDomainConfig: vi.fn(),
	getPlatformDomainConfig: vi.fn(),
	domainAuthProviderContext: null as unknown,
	env: {},
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("next/image", () => ({
	default: ({ alt, className }: { alt: string; className?: string }) => (
		<img alt={alt} className={className} data-testid="auth-side-image" />
	),
}));

vi.mock("next/navigation", () => ({
	notFound: mockState.notFound,
}));

vi.mock("next/script", () => ({
	default: (props: Record<string, unknown>) => <div data-testid={String(props.id)} {...props} />,
}));

vi.mock("next/server", () => ({
	connection: vi.fn(async () => undefined),
}));

vi.mock("@/components/info-footer", () => ({
	InfoFooter: () => <footer>Info footer</footer>,
}));

vi.mock("@/components/language-switcher", () => ({
	LanguageSwitcher: () => <button type="button">Language</button>,
}));

vi.mock("@/components/theme-toggle", () => ({
	ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("@/env", () => ({
	env: mockState.env,
}));

vi.mock("@/lib/auth/domain-auth-context", () => ({
	DomainAuthProvider: ({
		children,
		domainContext,
	}: {
		children: React.ReactNode;
		domainContext: unknown;
	}) => {
		mockState.domainAuthProviderContext = domainContext;
		return <>{children}</>;
	},
}));

vi.mock("@/lib/domain", () => ({
	classifyDomainHost: mockState.classifyDomainHost,
	getDomainConfig: mockState.getDomainConfig,
	getPlatformDomainConfig: mockState.getPlatformDomainConfig,
}));

vi.mock("@/lib/platform-settings", () => ({
	getCookieConsentScript: mockState.getCookieConsentScript,
}));

vi.mock("@/tolgee/shared", () => ({
	ALL_LANGUAGES: ["en"],
}));

describe("AuthLayout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.headers.mockResolvedValue(new Headers());
		mockState.classifyDomainHost.mockReturnValue({ type: "main", hostname: "app.z8.test" });
		mockState.getCookieConsentScript.mockResolvedValue(null);
		mockState.getDomainConfig.mockResolvedValue(null);
		mockState.getPlatformDomainConfig.mockResolvedValue(null);
		mockState.domainAuthProviderContext = null;
		mockState.env.MAIN_DOMAIN = "app.z8.test";
		mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
		mockState.env.TURNSTILE_SITE_KEY = undefined;
	});

	it("uses a full-page background image behind the auth content", async () => {
		render(
			await AuthLayout({
				children: <div>Auth content</div>,
			}),
		);

		const content = screen.getByText("Auth content");
		const authSection = content.closest("section");
		const backgroundImage = screen.getByTestId("auth-side-image");

		expect(authSection?.className).toContain("relative");
		expect(authSection?.className).toContain("z-10");
		expect(backgroundImage.className).toContain("absolute");
		expect(backgroundImage.className).toContain("inset-0");
		expect(backgroundImage.className).toContain("object-cover");
		expect(backgroundImage.closest("aside")).toBeNull();
	});

	it("does not fall back to the platform cookie script on custom domains", async () => {
		mockState.headers.mockResolvedValue(new Headers({ host: "login.acme.test" }));
		mockState.classifyDomainHost.mockReturnValue({
			type: "customDomain",
			hostname: "login.acme.test",
		});
		mockState.getCookieConsentScript.mockResolvedValue("platform()");
		mockState.getDomainConfig.mockResolvedValue({
			organizationId: "org_123",
			domain: "login.acme.test",
			authConfig: {
				emailPasswordEnabled: true,
				socialProvidersEnabled: [],
				ssoEnabled: false,
				passkeyEnabled: true,
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
		});

		render(await AuthLayout({ children: <div>Auth content</div> }));

		expect(mockState.getDomainConfig).toHaveBeenCalledWith("login.acme.test");
		expect(mockState.getCookieConsentScript).not.toHaveBeenCalled();
		expect(screen.queryByTestId("cookie-consent")).toBeNull();
	});

	it("uses platform organization context on platform subdomains", async () => {
		mockState.headers.mockResolvedValue(new Headers({ host: "acme.ui.z8-time.app" }));
		mockState.classifyDomainHost.mockReturnValue({
			type: "platformOrganization",
			hostname: "acme.ui.z8-time.app",
			label: "acme",
			rootDomain: "ui.z8-time.app",
		});
		mockState.env.TURNSTILE_SITE_KEY = "site_key";
		mockState.getCookieConsentScript.mockResolvedValue("<script>platform()</script>");
		mockState.getPlatformDomainConfig.mockResolvedValue({
			organizationId: "org_123",
			organizationSlug: "acme",
			domain: "acme.ui.z8-time.app",
			canonicalDomain: "acme.ui.z8-time.app",
			isCanonical: true,
			authConfig: {
				emailPasswordEnabled: true,
				socialProvidersEnabled: ["google"],
				ssoEnabled: false,
				passkeyEnabled: true,
			},
			branding: null,
			socialOAuthConfigured: {
				google: true,
				github: false,
				linkedin: false,
				apple: false,
			},
			turnstile: {
				enabled: false,
				siteKey: null,
				isEnterprise: false,
			},
		});

		render(await AuthLayout({ children: <div>Auth content</div> }));

		expect(mockState.getPlatformDomainConfig).toHaveBeenCalledWith("acme.ui.z8-time.app");
		expect(mockState.getDomainConfig).not.toHaveBeenCalled();
		expect(mockState.getCookieConsentScript).toHaveBeenCalled();
		expect(mockState.domainAuthProviderContext).toMatchObject({
			turnstile: {
				enabled: true,
				siteKey: "site_key",
				isEnterprise: false,
			},
		});
		expect(screen.getByTestId("cookie-consent")).toBeTruthy();
	});

	it("rejects unsupported platform subdomains instead of using global auth context", async () => {
		mockState.headers.mockResolvedValue(new Headers({ host: "deep.acme.ui.z8-time.app" }));
		mockState.classifyDomainHost.mockReturnValue({
			type: "unknownPlatform",
			hostname: "deep.acme.ui.z8-time.app",
			rootDomain: "ui.z8-time.app",
		});

		await expect(AuthLayout({ children: <div>Auth content</div> })).rejects.toThrow(
			"NEXT_NOT_FOUND",
		);

		expect(mockState.notFound).toHaveBeenCalled();
		expect(mockState.getPlatformDomainConfig).not.toHaveBeenCalled();
		expect(mockState.getDomainConfig).not.toHaveBeenCalled();
	});

	it("rejects missing platform organizations instead of using global auth context", async () => {
		mockState.headers.mockResolvedValue(new Headers({ host: "missing.ui.z8-time.app" }));
		mockState.classifyDomainHost.mockReturnValue({
			type: "platformOrganization",
			hostname: "missing.ui.z8-time.app",
			label: "missing",
			rootDomain: "ui.z8-time.app",
		});
		mockState.getPlatformDomainConfig.mockResolvedValue(null);

		await expect(AuthLayout({ children: <div>Auth content</div> })).rejects.toThrow(
			"NEXT_NOT_FOUND",
		);

		expect(mockState.notFound).toHaveBeenCalled();
		expect(mockState.getPlatformDomainConfig).toHaveBeenCalledWith("missing.ui.z8-time.app");
		expect(mockState.getDomainConfig).not.toHaveBeenCalled();
		expect(mockState.domainAuthProviderContext).toBeNull();
	});

	it("renders external cookie consent snippets as src scripts", async () => {
		mockState.headers.mockResolvedValue(new Headers({ host: "app.z8.test" }));
		mockState.classifyDomainHost.mockReturnValue({ type: "main", hostname: "app.z8.test" });
		mockState.getCookieConsentScript.mockResolvedValue(
			'<script id="Cookiebot" src="https://consent.example/uc.js" data-cbid="abc" async></script>',
		);

		render(await AuthLayout({ children: <div>Auth content</div> }));

		const script = screen.getByTestId("Cookiebot");
		expect(script.getAttribute("src")).toBe("https://consent.example/uc.js");
		expect(script.getAttribute("data-cbid")).toBe("abc");
	});
});
