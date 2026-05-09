/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthLayout from "./layout";

const mockState = vi.hoisted(() => ({
	headers: vi.fn(async () => new Headers()),
	getCookieConsentScript: vi.fn(async () => null),
	getDomainConfig: vi.fn(),
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
	DomainAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/domain", () => ({
	getDomainConfig: mockState.getDomainConfig,
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
		mockState.getCookieConsentScript.mockResolvedValue(null);
		mockState.getDomainConfig.mockResolvedValue(null);
		mockState.env.MAIN_DOMAIN = "app.z8.test";
	});

	it("keeps the image panel fixed while the left side scrolls", async () => {
		render(
			await AuthLayout({
				children: <div>Auth content</div>,
			}),
		);

		const content = screen.getByText("Auth content");
		const leftPanel = content.closest("section");
		const imagePanel = screen.getByTestId("auth-side-image").closest("aside");

		expect(leftPanel?.className).toContain("h-svh");
		expect(leftPanel?.className).toContain("overflow-y-auto");
		expect(imagePanel?.className).toContain("fixed");
		expect(imagePanel?.className).toContain("right-0");
		expect(imagePanel?.className).toContain("h-svh");
	});

	it("does not fall back to the platform cookie script on custom domains", async () => {
		mockState.headers.mockResolvedValue(new Headers({ host: "login.acme.test" }));
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

	it("renders external cookie consent snippets as src scripts", async () => {
		mockState.headers.mockResolvedValue(new Headers({ host: "app.z8.test" }));
		mockState.getCookieConsentScript.mockResolvedValue(
			'<script id="Cookiebot" src="https://consent.example/uc.js" data-cbid="abc" async></script>',
		);

		render(await AuthLayout({ children: <div>Auth content</div> }));

		const script = screen.getByTestId("Cookiebot");
		expect(script.getAttribute("src")).toBe("https://consent.example/uc.js");
		expect(script.getAttribute("data-cbid")).toBe("abc");
	});
});
