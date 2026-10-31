/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { isValidElement, Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthBackground } from "@/components/auth-background";
import AuthLayout, { AuthLayoutContent } from "./layout";
import source from "./layout.tsx?raw";

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

// Translation acquisition/lifecycle is exercised with real Tolgee in route-boundary.test.tsx.
vi.mock("@/tolgee/route-boundary", () => ({
	RouteTranslationBoundary: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("next/navigation", () => ({
	notFound: mockState.notFound,
}));

vi.mock("next/script", () => ({
	default: (props: Record<string, unknown>) => (
		<div data-testid={String(props.id)} {...props} />
	),
}));

vi.mock("next/server", () => ({
	connection: vi.fn(async () => undefined),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) =>
			key === "common:loading.authentication"
				? "Anmeldung wird geladen"
				: fallback,
	}),
}));

vi.mock("@/components/info-footer", () => ({
	InfoFooter: () => <footer>Info footer</footer>,
}));

vi.mock("@/components/auth-shell-controls", () => ({
	AuthShellControls: () => (
		<>
			<button type="button">Theme</button>
			<button type="button">Font size</button>
			<button type="button">Language</button>
		</>
	),
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

/** The page wrapper: the full-page background, then the request-dependent content's Suspense. */
function authLayoutParts(children: React.ReactNode) {
	const boundary = AuthLayout({
		params: Promise.resolve({ locale: "en" }),
		children,
	});
	expect(boundary.props.route).toBe("/sign-in");
	const wrapper = boundary.props.children;
	if (
		!isValidElement<{ className: string; children: React.ReactNode[] }>(wrapper)
	)
		throw new Error("Expected AuthLayout to return a page wrapper");
	const [background, suspense] = wrapper.props.children;
	if (
		!isValidElement(background) ||
		!isValidElement<{ fallback: React.ReactNode }>(suspense)
	)
		throw new Error("Expected the background and a Suspense boundary");
	return { wrapper, background, suspense };
}

describe("AuthLayout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.headers.mockResolvedValue(new Headers());
		mockState.classifyDomainHost.mockReturnValue({
			type: "main",
			hostname: "app.z8.test",
		});
		mockState.getCookieConsentScript.mockResolvedValue(null);
		mockState.getDomainConfig.mockResolvedValue(null);
		mockState.getPlatformDomainConfig.mockResolvedValue(null);
		mockState.domainAuthProviderContext = null;
		mockState.env.MAIN_DOMAIN = "app.z8.test";
		mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
		mockState.env.TURNSTILE_SITE_KEY = undefined;
	});

	it("places request-dependent auth content behind Suspense, above the background", () => {
		const { wrapper, background, suspense } = authLayoutParts(
			<div>Auth content</div>,
		);

		expect(wrapper.props.className).toContain("min-h-svh");
		expect(wrapper.props.className).toContain("bg-background");
		expect(background.type).toBe(AuthBackground);
		expect(suspense.type).toBe(Suspense);
	});

	it("renders neutral fallback geometry without tenant or child data", () => {
		const { suspense } = authLayoutParts(
			<div>secret.acme.example tenant sign-in</div>,
		);

		render(suspense.props.fallback);

		expect(
			screen
				.getByRole("status", { name: "Loading authentication" })
				.getAttribute("aria-busy"),
		).toBe("true");
		expect(
			screen.getByTestId("auth-layout-loading").getAttribute("aria-busy"),
		).toBe("true");
		expect(screen.getByText("Anmeldung wird geladen")).toBeTruthy();
		expect(screen.getByTestId("auth-layout-loading").className).toContain(
			"min-h-svh",
		);
		expect(screen.getByTestId("auth-controls-loading")).toBeTruthy();
		expect(screen.getByTestId("auth-footer-loading")).toBeTruthy();
		expect(
			screen.queryByText(/secret\.acme\.example|tenant sign-in/i),
		).toBeNull();
	});

	it("keeps connection inside the async auth content", () => {
		const contentStart = source.indexOf(
			"export async function AuthLayoutContent",
		);
		const connectionCall = source.indexOf("await connection()", contentStart);

		expect(contentStart).toBeGreaterThan(-1);
		expect(connectionCall).toBeGreaterThan(contentStart);
		expect(source.slice(0, contentStart)).not.toContain("connection()");
	});

	// The background image itself streams from AuthBackground (layout-background.test.tsx).
	it("stacks the auth content and readable controls above the full-page background", async () => {
		render(
			await AuthLayoutContent({
				children: <div>Auth content</div>,
			}),
		);

		const authSection = screen.getByText("Auth content").closest("section");

		expect(authSection?.className).toContain("relative");
		expect(authSection?.className).toContain("z-10");
		const controls = screen
			.getByRole("button", { name: "Font size" })
			.closest("div");
		expect(controls?.className).toContain("auth-shell-controls");
		expect(controls?.className).toContain("auth-shell-controls-readable");
		expect(controls?.className).toContain(
			"[&_[data-slot=dropdown-menu-trigger]]:!bg-slate-950/85",
		);
		expect(controls?.className).toContain(
			"[&_[data-slot=select-trigger]]:!bg-slate-950/85",
		);
	});

	it("clears the notch and home indicator of the store app shell (#846)", async () => {
		render(await AuthLayoutContent({ children: <div>Auth content</div> }));

		const authSection = screen.getByText("Auth content").closest("section");
		expect(authSection?.className).toContain("pt-[max(1rem,env(safe-area-inset-top))]");
		expect(authSection?.className).toContain("pb-[env(safe-area-inset-bottom)]");
	});

	it("does not fall back to the platform cookie script on custom domains", async () => {
		mockState.headers.mockResolvedValue(
			new Headers({ host: "login.acme.test" }),
		);
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

		render(await AuthLayoutContent({ children: <div>Auth content</div> }));

		expect(mockState.getDomainConfig).toHaveBeenCalledWith("login.acme.test");
		expect(mockState.getCookieConsentScript).not.toHaveBeenCalled();
		expect(screen.queryByTestId("cookie-consent")).toBeNull();
	});

	it("uses platform organization context on platform subdomains", async () => {
		mockState.headers.mockResolvedValue(
			new Headers({ host: "acme.ui.z8-time.app" }),
		);
		mockState.classifyDomainHost.mockReturnValue({
			type: "platformOrganization",
			hostname: "acme.ui.z8-time.app",
			label: "acme",
			rootDomain: "ui.z8-time.app",
		});
		mockState.env.TURNSTILE_SITE_KEY = "site_key";
		mockState.getCookieConsentScript.mockResolvedValue(
			"<script>platform()</script>",
		);
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

		render(await AuthLayoutContent({ children: <div>Auth content</div> }));

		expect(mockState.getPlatformDomainConfig).toHaveBeenCalledWith(
			"acme.ui.z8-time.app",
		);
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
		mockState.headers.mockResolvedValue(
			new Headers({ host: "deep.acme.ui.z8-time.app" }),
		);
		mockState.classifyDomainHost.mockReturnValue({
			type: "unknownPlatform",
			hostname: "deep.acme.ui.z8-time.app",
			rootDomain: "ui.z8-time.app",
		});

		await expect(
			AuthLayoutContent({ children: <div>Auth content</div> }),
		).rejects.toThrow("NEXT_NOT_FOUND");

		expect(mockState.notFound).toHaveBeenCalled();
		expect(mockState.getPlatformDomainConfig).not.toHaveBeenCalled();
		expect(mockState.getDomainConfig).not.toHaveBeenCalled();
	});

	it("rejects missing platform organizations instead of using global auth context", async () => {
		mockState.headers.mockResolvedValue(
			new Headers({ host: "missing.ui.z8-time.app" }),
		);
		mockState.classifyDomainHost.mockReturnValue({
			type: "platformOrganization",
			hostname: "missing.ui.z8-time.app",
			label: "missing",
			rootDomain: "ui.z8-time.app",
		});
		mockState.getPlatformDomainConfig.mockResolvedValue(null);

		await expect(
			AuthLayoutContent({ children: <div>Auth content</div> }),
		).rejects.toThrow("NEXT_NOT_FOUND");

		expect(mockState.notFound).toHaveBeenCalled();
		expect(mockState.getPlatformDomainConfig).toHaveBeenCalledWith(
			"missing.ui.z8-time.app",
		);
		expect(mockState.getDomainConfig).not.toHaveBeenCalled();
		expect(mockState.domainAuthProviderContext).toBeNull();
	});

	it("renders external cookie consent snippets as src scripts", async () => {
		mockState.headers.mockResolvedValue(new Headers({ host: "app.z8.test" }));
		mockState.classifyDomainHost.mockReturnValue({
			type: "main",
			hostname: "app.z8.test",
		});
		mockState.getCookieConsentScript.mockResolvedValue(
			'<script id="Cookiebot" src="https://consent.example/uc.js" data-cbid="abc" async></script>',
		);

		render(await AuthLayoutContent({ children: <div>Auth content</div> }));

		const script = screen.getByTestId("Cookiebot");
		expect(script.getAttribute("src")).toBe("https://consent.example/uc.js");
		expect(script.getAttribute("data-cbid")).toBe("abc");
	});
});
