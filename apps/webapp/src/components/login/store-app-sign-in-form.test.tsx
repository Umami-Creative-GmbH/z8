/* @vitest-environment jsdom */

import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainAuthProvider } from "@/lib/auth/domain-auth-context";
import { DEFAULT_AUTH_CONFIG, type DomainAuthContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({
	start: vi.fn(),
	search: new URLSearchParams(),
	assign: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.search }));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: React.ComponentProps<"a">) => <a href={href}>{children}</a>,
}));
// External Capacitor bridge only; native loader, PKCE, transport and controller run unchanged.
vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({ start: mocks.start }) }));

import { StoreAppSignInForm } from "./store-app-sign-in-form";

const domain: DomainAuthContext = {
	organizationId: "unit-org",
	domain: "team.example.test",
	authConfig: DEFAULT_AUTH_CONFIG,
	branding: {
		appName: "Example workplace",
		logoUrl: null,
		backgroundImageUrl: null,
		primaryColor: null,
		accentColor: null,
	},
	socialOAuthConfigured: { google: false, github: false, linkedin: false, apple: false },
	turnstile: { enabled: false, siteKey: null, isEnterprise: false },
};
function arrival(context = domain) {
	const view = (value: DomainAuthContext) => (
		<DomainAuthProvider domainContext={value}>
			<StoreAppSignInForm />
		</DomainAuthProvider>
	);
	const result = render(view(context));
	return { ...result, change: (value: DomainAuthContext) => result.rerender(view(value)) };
}
function submit() {
	fireEvent.change(screen.getByLabelText("Email"), { target: { value: "  ada@example.test " } });
	fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("store app email screen and frozen native transport", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.search = new URLSearchParams();
		mocks.start.mockResolvedValue({ url: "z8mobile://auth/callback?code=unit-only-code" });
		vi.stubGlobal("crypto", webcrypto);
		vi.stubGlobal("navigator", { userAgent: "Test Z8StoreApp/ios" });
		vi.stubGlobal("location", {
			href: "https://team.example.test/en/sign-in",
			assign: mocks.assign,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					authorizeUrl: "https://team.example.test/app-login?unit-only=true",
				}),
			}),
		);
	});
	afterEach(() => vi.unstubAllGlobals());

	it("preserves resolved branding, trimmed email, PKCE, system-browser callback and final destination", async () => {
		mocks.search = new URLSearchParams({ callbackUrl: "/time-tracking" });
		arrival();
		submit();
		await waitFor(() => expect(mocks.assign).toHaveBeenCalledOnce());
		expect(screen.getByText("Example workplace")).toBeTruthy();
		const calls = vi.mocked(fetch).mock.calls;
		expect(calls[0][0]).toBe("/api/auth/app-sign-in");
		expect(JSON.parse(calls[0][1]?.body as string)).toEqual({
			email: "ada@example.test",
			challenge: expect.stringMatching(/^[\w-]{43}$/),
		});
		expect(mocks.start).toHaveBeenCalledWith({
			url: "https://team.example.test/app-login?unit-only=true",
			callbackScheme: "z8mobile",
		});
		expect(calls[1][0]).toBe("/api/auth/app-exchange");
		expect(calls[1][1]).toMatchObject({
			credentials: "same-origin",
			headers: { "X-Z8-App-Type": "mobile" },
		});
		expect(mocks.assign).toHaveBeenCalledWith("/init?callbackUrl=%2Ftime-tracking");
	});
	it("refuses invalid email before any native or server transport and focuses its error", async () => {
		const view = arrival();
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@" } });
		const form = view.container.querySelector("form");
		if (!form) throw new Error("Missing form");
		fireEvent.submit(form);
		await screen.findByText("Invalid email address");
		expect(fetch).not.toHaveBeenCalled();
		expect(mocks.start).not.toHaveBeenCalled();
		await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Email")));
	});
	it.each([
		[429, "Too many sign-in attempts. Please wait a moment and try again."],
		[503, "Z8 could not be reached. Check your connection and try again."],
	])("keeps input and retry after start status %s", async (status, message) => {
		vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status } as Response);
		arrival();
		submit();
		await screen.findByText(message);
		expect(screen.getByLabelText("Email")).toHaveProperty("value", "ada@example.test");
		expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", false);
		expect(mocks.assign).not.toHaveBeenCalled();
	});
	it("explains a refused code exchange without replacing the native protocol", async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ authorizeUrl: "https://team.example.test/app-login" }),
			} as Response)
			.mockResolvedValueOnce({ ok: false, status: 400 } as Response);
		arrival();
		submit();
		await screen.findByText("Sign-in did not complete or has expired. Please try again.");
		expect(mocks.assign).not.toHaveBeenCalled();
	});
	it("returns quietly after real native cancellation", async () => {
		mocks.start.mockRejectedValue({ code: "cancelled" });
		arrival();
		submit();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", false),
		);
		expect(screen.queryByRole("alert")).toBeNull();
		expect(fetch).toHaveBeenCalledOnce();
	});
	it("reserves duplicate native submission and retires late completion on changed domain", async () => {
		const native = Promise.withResolvers();
		mocks.start.mockReturnValue(native.promise);
		const view = arrival();
		submit();
		const form = view.container.querySelector("form");
		if (!form) throw new Error("Missing form");
		fireEvent.submit(form);
		await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
		view.change({ ...domain, organizationId: "other-org" });
		await act(async () => native.resolve({ url: "z8mobile://auth/callback?code=unit-only-code" }));
		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
		// The already dispatched canonical transport may finish; only obsolete UI navigation is retired.
		expect(mocks.assign).not.toHaveBeenCalled();
	});
});
