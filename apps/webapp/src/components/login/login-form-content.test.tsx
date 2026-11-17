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
function challenge() {
	fireEvent.click(screen.getByRole("button", { name: "Complete challenge" }));
}
function submit() {
	fireEvent.click(screen.getByRole("button", { name: "Login", exact: true }));
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

	it("explains required verification and offers a real-widget retry after timeout", async () => {
		arrival();
		expect(screen.getByRole("button", { name: "Login", exact: true })).toHaveProperty(
			"disabled",
			true,
		);
		expect(screen.getByRole("status").textContent).toContain("verification");
		fireEvent.click(screen.getByRole("button", { name: "Challenge timeout" }));
		fireEvent.click(screen.getByRole("button", { name: "Retry verification" }));
		expect(mocks.reset).toHaveBeenCalled();
		expect(mocks.email).not.toHaveBeenCalled();
		challenge();
		expect(screen.getByRole("button", { name: "Login", exact: true })).toHaveProperty(
			"disabled",
			false,
		);
	});

	it("reserves native submission once and retires a late success when the actor changes", async () => {
		const result = Promise.withResolvers<{ error: null }>();
		mocks.email.mockReturnValue(result.promise);
		const view = arrival();
		credentials();
		challenge();
		const form = view.container.querySelector("form");
		if (!form) throw new Error("Missing sign-in form");
		fireEvent.submit(form);
		fireEvent.submit(form);
		await waitFor(() => expect(mocks.email).toHaveBeenCalledOnce());
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "another@example.test" } });
		await act(async () => result.resolve({ error: null }));
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("keeps canonical defaults and focuses the first invalid field without transport", async () => {
		const view = arrival();
		expect(screen.getByLabelText("Email")).toHaveProperty("value", "");
		expect(screen.getByLabelText("Password")).toHaveProperty("value", "");
		challenge();
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "invalid" } });
		const form = view.container.querySelector("form");
		if (!form) throw new Error("Missing form");
		fireEvent.submit(form);
		await screen.findByText("Invalid email address");
		await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Email")));
		expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
		expect(mocks.email).not.toHaveBeenCalled();
	});

	it("submits the current challenge only once and retains fields for a fresh retry", async () => {
		mocks.email.mockResolvedValueOnce({ error: { status: 400, message: "Verification refused" } });
		arrival();
		credentials();
		challenge();
		submit();
		await screen.findByText("Verification refused");
		expect(mocks.email.mock.calls[0][0]).toEqual({
			email: "person@example.test",
			password: "unit-only-password",
		});
		expect(mocks.email.mock.calls[0][1].headers).toEqual({
			"x-captcha-response": "unit-challenge-one",
		});
		expect(mocks.reset).toHaveBeenCalledOnce();
		expect(screen.getByLabelText("Email")).toHaveProperty("value", "person@example.test");
		expect(screen.getByRole("button", { name: "Login", exact: true })).toHaveProperty(
			"disabled",
			true,
		);
		fireEvent.click(screen.getByRole("button", { name: "Fresh challenge" }));
		submit();
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/init"));
		expect(mocks.email.mock.calls[1][1].headers).toEqual({
			"x-captcha-response": "unit-challenge-two",
		});
	});

	it.each(["Challenge error", "Challenge expiry", "Challenge timeout"])(
		"invalidates a token after %s and requires a fresh completion",
		async (event) => {
			arrival();
			credentials();
			challenge();
			fireEvent.click(screen.getByRole("button", { name: event }));
			expect(screen.getByRole("button", { name: "Login", exact: true })).toHaveProperty(
				"disabled",
				true,
			);
			expect(screen.getByRole("status").textContent).toMatch(/try again/);
			expect(mocks.email).not.toHaveBeenCalled();
		},
	);

	it.each(["success", "refusal", "rejection"])(
		"ignores a late email %s after domain policy changes",
		async (outcome) => {
			const deferred = Promise.withResolvers();
			mocks.email.mockReturnValue(deferred.promise);
			const view = arrival();
			credentials();
			challenge();
			submit();
			await waitFor(() => expect(mocks.email).toHaveBeenCalledOnce());
			view.change({
				...domain,
				organizationId: "another-organization",
				authConfig: {
					...DEFAULT_AUTH_CONFIG,
					emailPasswordEnabled: false,
					ssoEnabled: true,
					ssoProviderId: "unit-sso",
				},
			});
			await act(async () => {
				if (outcome === "rejection") deferred.reject(new Error("old failure"));
				else
					deferred.resolve(
						outcome === "success"
							? { error: null }
							: { error: { status: 401, message: "old refusal" } },
					);
			});
			expect(screen.queryByLabelText("Email")).toBeNull();
			expect(screen.queryByText(/old failure|old refusal/)).toBeNull();
			expect(mocks.push).not.toHaveBeenCalled();
		},
	);

	it("retires late status-read continuation when the callback changes", async () => {
		const deferred = Promise.withResolvers();
		vi.mocked(fetch).mockReturnValue(deferred.promise as Promise<Response>);
		const view = arrival();
		credentials();
		challenge();
		submit();
		await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/user/onboarding-status"));
		mocks.search = new URLSearchParams({ callbackUrl: "/calendar" });
		view.change();
		await act(async () =>
			deferred.resolve({ ok: true, json: async () => ({ onboardingComplete: true }) }),
		);
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("retires pending work through Activity hide and resume", async () => {
		const deferred = Promise.withResolvers();
		mocks.email.mockReturnValue(deferred.promise);
		const view = arrival();
		credentials();
		challenge();
		submit();
		await waitFor(() => expect(mocks.email).toHaveBeenCalledOnce());
		view.change(domain, "hidden");
		view.change();
		await act(async () => deferred.resolve({ error: null }));
		expect(mocks.push).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Login", exact: true })).toHaveProperty(
			"disabled",
			true,
		);
	});

	it("keeps current 403 email verification continuation and cancels it on editing", async () => {
		vi.useFakeTimers();
		mocks.email.mockImplementation(async (_values, options) => {
			const error = { status: 403 };
			options.onError({ error });
			return { error };
		});
		const view = arrival();
		credentials();
		challenge();
		submit();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "changed@example.test" } });
		await act(async () => vi.advanceTimersByTimeAsync(3000));
		expect(mocks.push).not.toHaveBeenCalled();
		view.unmount();
	});

	it("continues unverified email with the sanitized intended destination", async () => {
		vi.useFakeTimers();
		mocks.search = new URLSearchParams({ callbackUrl: "/calendar" });
		mocks.email.mockResolvedValue({ error: { status: 403 } });
		arrival();
		credentials();
		challenge();
		submit();
		await act(async () => vi.advanceTimersByTimeAsync(3001));
		expect(mocks.push).toHaveBeenCalledWith(
			"/verify-email-pending?email=person%40example.test&callbackUrl=%2Fcalendar",
		);
	});

	it("preserves inline two-factor, trust-device payload and native form continuation", async () => {
		mocks.email.mockResolvedValue({ error: null, data: { twoFactorRedirect: true } });
		mocks.verifyTotp.mockResolvedValueOnce({ error: { message: "Code refused" } });
		arrival();
		credentials();
		challenge();
		submit();
		const otp = await screen.findByLabelText("Two-Factor Authentication Code");
		expect(screen.getByLabelText("Email").closest("fieldset")).toHaveProperty("disabled", true);
		expect(screen.queryByRole("button", { name: "Login with Passkey" })).toBeNull();
		expect(screen.getByRole("switch")).toHaveProperty("ariaChecked", "false");
		fireEvent.change(otp, { target: { value: "123456" } });
		fireEvent.click(screen.getByRole("switch"));
		fireEvent.click(screen.getByRole("button", { name: "Verify and Login" }));
		await screen.findByText("Code refused");
		expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: "123456", trustDevice: true });
		const form = otp.closest("form");
		if (!form) throw new Error("Missing form");
		fireEvent.submit(form);
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/init"));
		expect(mocks.email).toHaveBeenCalledOnce();
	});

	it("uses the saved onboarding step after email authentication", async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ onboardingComplete: false, onboardingStep: "profile" }),
		} as Response);
		arrival();
		credentials();
		challenge();
		submit();
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/profile"));
	});

	it.each(["passkey", "sso", "google"])(
		"recovers from an actual %s client refusal",
		async (method) => {
			mocks[method === "google" ? "social" : method].mockResolvedValueOnce({
				error: { message: "Method refused" },
			});
			const view = arrival({
				...domain,
				authConfig: { ...DEFAULT_AUTH_CONFIG, ssoEnabled: true, ssoProviderId: "unit-sso" },
			});
			act(() =>
				view.queryClient.setQueryData(
					["auth", "providers"],
					[{ id: "google", name: "Google", icon: () => null }],
				),
			);
			fireEvent.click(
				await screen.findByRole("button", {
					name:
						method === "passkey"
							? "Login with Passkey"
							: method === "sso"
								? "Sign in with SSO"
								: "Login with Google",
				}),
			);
			await screen.findByText("Method refused");
			expect(screen.getByRole("button", { name: "Login with Passkey" })).toHaveProperty(
				"disabled",
				false,
			);
			expect(mocks.push).not.toHaveBeenCalled();
		},
	);

	it("renders only allowed methods with resolved branding and preserves recovery callbacks", async () => {
		mocks.search = new URLSearchParams({ callbackUrl: "//evil.example.test" });
		const view = arrival({
			...domain,
			authConfig: {
				...DEFAULT_AUTH_CONFIG,
				socialProvidersEnabled: ["google"],
				passkeyEnabled: false,
			},
		});
		act(() =>
			view.queryClient.setQueryData(
				["auth", "providers"],
				[
					{ id: "google", name: "Google", icon: () => null },
					{ id: "github", name: "GitHub", icon: () => null },
				],
			),
		);
		expect(screen.getByText("Example workplace")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Login with Passkey" })).toBeNull();
		expect(await screen.findByRole("button", { name: "Login with Google" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Login with GitHub" })).toBeNull();
		expect(screen.getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe(
			"/sign-up?callbackUrl=%2Finit",
		);
		expect(screen.getByRole("link", { name: "Forgot your password?" }).getAttribute("href")).toBe(
			"/forgot-password",
		);
	});
	it("retires queued native activation when email changes during validation", async () => {
		const view = arrival();
		credentials();
		challenge();
		const form = view.container.querySelector("form");
		if (!form) throw new Error("Missing form");
		fireEvent.submit(form);
		fireEvent.change(screen.getByLabelText("Email"), {
			target: { value: "replacement@example.test" },
		});
		await act(async () => {});
		expect(mocks.email).not.toHaveBeenCalled();
	});
	it("keeps the configured SSO method and exact canonical callback payload", async () => {
		mocks.search = new URLSearchParams({ callbackUrl: "/calendar" });
		arrival({
			...domain,
			authConfig: {
				emailPasswordEnabled: false,
				passkeyEnabled: false,
				ssoEnabled: true,
				ssoProviderId: "unit-sso",
				socialProvidersEnabled: [],
			},
		});
		expect(screen.queryByLabelText("Email")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
		await waitFor(() =>
			expect(mocks.sso).toHaveBeenCalledWith({
				providerId: "unit-sso",
				callbackURL: "/init?callbackUrl=%2Fcalendar",
			}),
		);
		expect(mocks.email).not.toHaveBeenCalled();
	});
	it("reports missing SSO configuration without invoking a provider", async () => {
		arrival({ ...domain, authConfig: { ...DEFAULT_AUTH_CONFIG, ssoEnabled: true } });
		fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }));
		expect(await screen.findByText("SSO is not configured for this domain")).toBeTruthy();
		expect(mocks.sso).not.toHaveBeenCalled();
	});
	it("uses the existing organization social redirect with a safe callback", async () => {
		const assign = vi.fn();
		vi.stubGlobal("location", { href: "https://team.example.test/en/sign-in", assign });
		mocks.search = new URLSearchParams({ callbackUrl: "/calendar" });
		const view = arrival({
			...domain,
			socialOAuthConfigured: { ...domain.socialOAuthConfigured, google: true },
		});
		act(() =>
			view.queryClient.setQueryData(
				["auth", "providers"],
				[{ id: "google", name: "Google", icon: () => null }],
			),
		);
		fireEvent.click(await screen.findByRole("button", { name: "Login with Google" }));
		expect(assign).toHaveBeenCalledWith(
			"/api/auth/social-org/google?callbackURL=%2Finit%3FcallbackUrl%3D%252Fcalendar",
		);
		expect(mocks.social).not.toHaveBeenCalled();
	});
	it("retains passkey options and canonical callback sanitization", async () => {
		mocks.search = new URLSearchParams({ callbackUrl: "https://attacker.example.test" });
		arrival();
		fireEvent.click(screen.getByRole("button", { name: "Login with Passkey" }));
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/init"));
		expect(mocks.passkey).toHaveBeenCalledWith({ autoFill: false });
	});
	it("shows provider loading, refusal and retry through the real query transport", async () => {
		const response = Promise.withResolvers<Response>();
		vi.mocked(fetch).mockReturnValueOnce(response.promise);
		const view = arrival({
			...domain,
			authConfig: { ...DEFAULT_AUTH_CONFIG, passkeyEnabled: false },
		});
		act(() => {
			void view.queryClient.invalidateQueries({ queryKey: ["auth", "providers"] });
		});
		await act(async () => response.reject(new Error("unit network refusal")));
		expect(await screen.findByText("Other sign-in methods could not be loaded.")).toBeTruthy();
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ providers: ["google"] }),
		} as Response);
		fireEvent.click(screen.getByRole("button", { name: "Retry sign-in methods" }));
		expect(await screen.findByRole("button", { name: "Login with Google" })).toBeTruthy();
		expect(fetch).toHaveBeenCalledWith(
			"/api/auth/providers",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});
	it("retires a late two-factor success after the callback changes", async () => {
		mocks.email.mockResolvedValue({ error: null, data: { twoFactorRedirect: true } });
		const deferred = Promise.withResolvers();
		mocks.verifyTotp.mockReturnValue(deferred.promise);
		const view = arrival();
		credentials();
		challenge();
		submit();
		const otp = await screen.findByLabelText("Two-Factor Authentication Code");
		fireEvent.change(otp, { target: { value: "123456" } });
		fireEvent.click(screen.getByRole("button", { name: "Verify and Login" }));
		await waitFor(() => expect(mocks.verifyTotp).toHaveBeenCalledOnce());
		mocks.search = new URLSearchParams({ callbackUrl: "/calendar" });
		view.change();
		await act(async () => deferred.resolve({ error: null }));
		expect(mocks.push).not.toHaveBeenCalled();
	});
});
