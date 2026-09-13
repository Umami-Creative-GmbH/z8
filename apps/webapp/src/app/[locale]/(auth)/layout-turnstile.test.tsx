/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginFormContent } from "@/components/login/login-form-content";
import { resolveTurnstileAuthPolicy } from "@/lib/turnstile/auth-policy";
import { AuthLayoutContent } from "./layout";

const mocks = vi.hoisted(() => ({
	env: {
		APP_URL: undefined as string | undefined,
		BETTER_AUTH_URL: undefined as string | undefined,
		NEXT_PUBLIC_APP_URL: undefined as string | undefined,
		MAIN_DOMAIN: undefined as string | undefined,
		PLATFORM_DOMAIN: undefined as string | undefined,
		TURNSTILE_SITE_KEY: "global-site" as string | undefined,
	},
	headers: vi.fn(),
	getDomainConfig: vi.fn(),
	signInEmail: vi.fn(),
}));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/social-oauth", () => ({ getConfiguredProviders: vi.fn() }));
vi.mock("@/lib/domain/domain-service", () => ({ getDomainConfig: mocks.getDomainConfig }));
vi.mock("@/lib/domain", async () => ({
	...(await import("@/lib/domain/platform-domain")),
	getDomainConfig: mocks.getDomainConfig,
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
	notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("@/tolgee/shared", () => ({ ALL_LANGUAGES: ["en"] }));
vi.mock("@/components/auth-background-image", () => ({ AuthBackgroundImage: () => null }));
vi.mock("@/components/info-footer", () => ({ InfoFooter: () => null }));
vi.mock("@/components/language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/font-size-toggle", () => ({ FontSizeToggle: () => null }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/lib/platform-settings", () => ({ getCookieConsentScript: async () => null }));
vi.mock("@/lib/hooks/use-enabled-providers", () => ({
	useEnabledProviders: () => ({ enabledProviders: [], isLoading: false }),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { email: mocks.signInEmail } } }));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
	useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/turnstile-widget", () => ({
	TurnstileWidget: ({ siteKey, onVerify }: { siteKey: string; onVerify: (token: string) => void }) => (
		<button type="button" data-site-key={siteKey} onClick={() => onVerify("fresh-token")}>
			Complete verification
		</button>
	),
}));

describe("auth layout and login Turnstile policy agreement", () => {
	afterEach(cleanup);
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.APP_URL = undefined;
		mocks.env.BETTER_AUTH_URL = undefined;
		mocks.env.NEXT_PUBLIC_APP_URL = undefined;
		mocks.env.MAIN_DOMAIN = undefined;
		mocks.env.PLATFORM_DOMAIN = undefined;
		mocks.env.TURNSTILE_SITE_KEY = "global-site";
		mocks.getDomainConfig.mockResolvedValue(null);
		mocks.headers.mockResolvedValue(new Headers({ host: "selfhost.example.net:8443" }));
		mocks.signInEmail.mockResolvedValue({ error: { status: 400, message: "Test auth response" } });
	});

	it.each(["APP_URL", "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL"] as const)(
		"%s-only deployment renders the global widget and submits its token to login",
		async (setting) => {
			mocks.env[setting] = "https://selfhost.example.net:8443";
			render(await AuthLayoutContent({ children: <LoginFormContent /> }));
			const widget = screen.getByRole("button", { name: "Complete verification" });
			expect(widget.getAttribute("data-site-key")).toBe("global-site");
			expect(await resolveTurnstileAuthPolicy("selfhost.example.net:8443")).toMatchObject({
				enabled: true, isEnterprise: false, hostname: "selfhost.example.net",
			});
			expect(mocks.getDomainConfig).not.toHaveBeenCalled();
			fireEvent.click(widget);
			fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.net" } });
			fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Synthetic-password" } });
			fireEvent.click(screen.getByRole("button", { name: "Login" }));
			await waitFor(() => expect(mocks.signInEmail).toHaveBeenCalledOnce());
			expect(mocks.signInEmail.mock.calls[0][1]).toMatchObject({ headers: { "x-captcha-response": "fresh-token" } });
		},
	);

	it("a verified custom tenant still renders its own widget and uses its own policy", async () => {
		mocks.env.APP_URL = "https://selfhost.example.net:8443";
		mocks.headers.mockResolvedValue(new Headers({ host: "login.tenant.example.org" }));
		mocks.getDomainConfig.mockResolvedValue({
			organizationId: "tenant-a", domain: "login.tenant.example.org",
			authConfig: { turnstileSiteKey: "tenant-site" },
			turnstile: { enabled: true, siteKey: "tenant-site", isEnterprise: true },
		});
		render(await AuthLayoutContent({ children: <LoginFormContent /> }));
		expect(screen.getByRole("button", { name: "Complete verification" }).getAttribute("data-site-key")).toBe("tenant-site");
		expect(await resolveTurnstileAuthPolicy("login.tenant.example.org")).toMatchObject({
			enabled: true, isEnterprise: true, organizationId: "tenant-a",
		});
	});

	it("CAPTCHA-disabled self-hosted login has no widget and the server also disables CAPTCHA", async () => {
		mocks.env.APP_URL = "https://selfhost.example.net:8443";
		mocks.env.TURNSTILE_SITE_KEY = undefined;
		render(await AuthLayoutContent({ children: <LoginFormContent /> }));
		expect(screen.queryByRole("button", { name: "Complete verification" })).toBeNull();
		expect((screen.getByRole("button", { name: "Login" }) as HTMLButtonElement).disabled).toBe(false);
		expect(await resolveTurnstileAuthPolicy("selfhost.example.net:8443")).toMatchObject({ enabled: false });
		expect(mocks.getDomainConfig).not.toHaveBeenCalled();
	});

	it("a suffix-spoofed host never receives global widget context and fails closed on the server", async () => {
		mocks.env.APP_URL = "https://selfhost.example.net:8443";
		const host = "selfhost.example.net.attacker.org";
		mocks.headers.mockResolvedValue(new Headers({ host, "x-forwarded-host": "selfhost.example.net:8443" }));
		render(await AuthLayoutContent({ children: <LoginFormContent /> }));
		expect(screen.queryByRole("button", { name: "Complete verification" })).toBeNull();
		await expect(resolveTurnstileAuthPolicy(host)).rejects.toThrow("Unknown authentication host");
	});
});
