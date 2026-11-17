/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainAuthProvider } from "@/lib/auth/domain-auth-context";
import { DEFAULT_AUTH_CONFIG, type DomainAuthContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({
	push: vi.fn(),
	email: vi.fn(),
	passkey: vi.fn(),
	social: vi.fn(),
	sso: vi.fn(),
	verifyTotp: vi.fn(),
	reset: vi.fn(),
	search: new URLSearchParams(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.search }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: mocks.push }),
	Link: ({ children, href, ...props }: React.ComponentProps<"a">) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
vi.mock("@/lib/auth/auth-page-client", () => ({
	authPageClient: {
		signIn: { email: mocks.email, passkey: mocks.passkey, social: mocks.social, sso: mocks.sso },
		twoFactor: { verifyTotp: mocks.verifyTotp },
	},
}));
// External Cloudflare adapter only. The real wrapper, context, controller and form run.
vi.mock("@marsidev/react-turnstile", () => ({
	Turnstile: (props: {
		ref: React.Ref<{ reset: () => void }>;
		onSuccess: (token: string) => void;
		onError: () => void;
		onExpire: () => void;
		onTimeout: () => void;
	}) => {
		useImperativeHandle(props.ref, () => ({ reset: mocks.reset }));
		return (
			<div>
				<button type="button" onClick={() => props.onSuccess("unit-challenge-one")}>
					Complete challenge
				</button>
				<button type="button" onClick={() => props.onSuccess("unit-challenge-two")}>
					Fresh challenge
				</button>
				<button type="button" onClick={props.onError}>
					Challenge error
				</button>
				<button type="button" onClick={props.onExpire}>
					Challenge expiry
				</button>
				<button type="button" onClick={props.onTimeout}>
					Challenge timeout
				</button>
			</div>
		);
	},
}));

import { LoginFormContent } from "./login-form-content";

const domain: DomainAuthContext = {
	organizationId: "unit-organization",
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
	turnstile: { enabled: true, siteKey: "unit-public-site-key", isEnterprise: false },
};

function arrival(context = domain, mode: "visible" | "hidden" = "visible") {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	queryClient.setQueryData(["auth", "providers"], []);
	const view = (value: DomainAuthContext, visibility: "visible" | "hidden") => (
		<QueryClientProvider client={queryClient}>
			<DomainAuthProvider domainContext={value}>
				<Activity mode={visibility}>
					<LoginFormContent />
				</Activity>
			</DomainAuthProvider>
		</QueryClientProvider>
	);
	const result = render(view(context, mode));
	return {
		...result,
		queryClient,
		change: (value = context, visibility: "visible" | "hidden" = "visible") =>
			result.rerender(view(value, visibility)),
	};
}
function credentials() {
	fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.test" } });
	fireEvent.change(screen.getByLabelText("Password"), { target: { value: "unit-only-password" } });
}

describe("current-domain sign-in journey", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
		mocks.search = new URLSearchParams();
		for (const method of [mocks.email, mocks.passkey, mocks.social, mocks.sso, mocks.verifyTotp])
			method.mockResolvedValue({ error: null });
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, json: async () => ({ onboardingComplete: true }) }),
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("review control: suppresses duplicate passkey activation until settlement and continues current success", async () => {
		const result = Promise.withResolvers();
		mocks.passkey.mockReturnValueOnce(result.promise);
		arrival();
		const button = screen.getByRole("button", { name: "Login with Passkey" });
		fireEvent.click(button);
		await waitFor(() => expect(mocks.passkey).toHaveBeenCalledOnce());
		expect(button).toHaveProperty("disabled", true);
		fireEvent.click(button);
		expect(mocks.passkey).toHaveBeenCalledOnce();
		await act(async () => result.resolve({ error: null }));
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/init"));
		expect(mocks.passkey).toHaveBeenCalledWith({ autoFill: false });
	});
	it("review control: retains credential drafts and recovers after passkey refusal", async () => {
		mocks.passkey.mockResolvedValueOnce({ error: { message: "Synthetic refusal" } });
		arrival();
		credentials();
		fireEvent.click(screen.getByRole("button", { name: "Login with Passkey" }));
		await screen.findByText("Synthetic refusal");
		expect(screen.getByLabelText("Email")).toHaveProperty("value", "person@example.test");
		expect(screen.getByLabelText("Password")).toHaveProperty("value", "unit-only-password");
		fireEvent.click(screen.getByRole("button", { name: "Login with Passkey" }));
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/init"));
		expect(mocks.passkey).toHaveBeenCalledTimes(2);
	});
	it("review control: retires the old passkey continuation on Activity cleanup", async () => {
		const result = Promise.withResolvers();
		mocks.passkey.mockReturnValueOnce(result.promise);
		const view = arrival();
		fireEvent.click(screen.getByRole("button", { name: "Login with Passkey" }));
		await waitFor(() => expect(mocks.passkey).toHaveBeenCalledOnce());
		view.change(domain, "hidden");
		view.change();
		await act(async () => result.resolve({ error: null }));
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it.each(["passkey", "sso", "google"] as const)(
		"keeps a dispatched %s reserved through Activity until settlement, then accepts a fresh retry",
		async (method) => {
			const action = mocks[method === "google" ? "social" : method];
			const first = Promise.withResolvers();
			const second = Promise.withResolvers();
			action.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
			const context = {
				...domain,
				authConfig: {
					...DEFAULT_AUTH_CONFIG,
					ssoEnabled: true,
					ssoProviderId: "unit-sso-provider",
					socialProvidersEnabled: ["google"],
				},
			};
			const view = arrival(context);
			credentials();
			await act(async () => {
				view.queryClient.setQueryData(
					["auth", "providers"],
					[{ id: "google", name: "Google", icon: () => null }],
				);
			});
			const label =
				method === "passkey"
					? "Login with Passkey"
					: method === "sso"
						? "Sign in with SSO"
						: "Login with Google";
			fireEvent.click(await screen.findByRole("button", { name: label }));
			await waitFor(() => expect(action).toHaveBeenCalledOnce());
			view.change(context, "hidden");
			view.change(context);
			const pendingLabel = method === "sso" ? "Connecting to SSO…" : label;
			const resumed = screen.getByRole("button", { name: pendingLabel });
			expect(resumed).toHaveProperty("disabled", true);
			fireEvent.click(resumed);
			await act(async () => {});
			expect(action.mock.calls.length, "external requests before the original settles").toBe(1);
			await act(async () => first.resolve({ error: null }));
			expect(mocks.push).not.toHaveBeenCalled();
			expect(screen.getByLabelText("Email")).toHaveProperty("value", "person@example.test");
			expect(screen.getByLabelText("Password")).toHaveProperty("value", "unit-only-password");
			await waitFor(() =>
				expect(screen.getByRole("button", { name: label })).toHaveProperty("disabled", false),
			);
			fireEvent.click(screen.getByRole("button", { name: label }));
			await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
			await act(async () => second.resolve({ error: null }));
			if (method === "passkey") {
				await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/init"));
				expect(action).toHaveBeenLastCalledWith({ autoFill: false });
			} else if (method === "sso") {
				expect(action).toHaveBeenLastCalledWith({
					providerId: "unit-sso-provider",
					callbackURL: "/init",
				});
			} else {
				expect(action).toHaveBeenLastCalledWith({ provider: "google", callbackURL: "/init" });
			}
		},
	);
	it.each(["refusal", "rejection"] as const)(
		"releases a retired passkey after late %s without stale feedback",
		async (settlement) => {
			const pending = Promise.withResolvers();
			mocks.passkey.mockReturnValueOnce(pending.promise);
			const view = arrival();
			fireEvent.click(screen.getByRole("button", { name: "Login with Passkey" }));
			await waitFor(() => expect(mocks.passkey).toHaveBeenCalledOnce());
			view.change(domain, "hidden");
			view.change();
			await act(async () => {
				if (settlement === "refusal") pending.resolve({ error: { message: "Retired refusal" } });
				else pending.reject(new Error("Retired rejection"));
			});
			await waitFor(() =>
				expect(screen.getByRole("button", { name: "Login with Passkey" })).toHaveProperty(
					"disabled",
					false,
				),
			);
			expect(mocks.push).not.toHaveBeenCalled();
			expect(screen.queryByRole("alert")).toBeNull();
		},
	);
});
