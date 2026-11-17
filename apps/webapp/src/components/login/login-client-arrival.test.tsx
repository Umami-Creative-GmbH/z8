/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";
import { DomainAuthProvider } from "@/lib/auth/domain-auth-context";
import { DEFAULT_AUTH_CONFIG, type DomainAuthContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({
	clientGate: Promise.withResolvers<void>(),
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
vi.mock("@/lib/auth/auth-page-client", async () => {
	await mocks.clientGate.promise;
	return {
		authPageClient: {
			signIn: { email: mocks.email, passkey: mocks.passkey, social: mocks.social, sso: mocks.sso },
			twoFactor: { verifyTotp: mocks.verifyTotp },
		},
	};
});
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

describe("sign-in client import arrival", () => {
	it("withholds an expired token during client loading and sends a fresh real-callback value on retry", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, json: async () => ({ onboardingComplete: true }) }),
		);
		mocks.email.mockResolvedValue({ error: null });
		arrival();
		credentials();
		challenge();
		submit();
		fireEvent.click(screen.getByRole("button", { name: "Challenge expiry" }));
		await act(async () => mocks.clientGate.resolve());
		expect(await screen.findByText("Please complete the verification.")).toBeTruthy();
		expect(mocks.email).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Fresh challenge" }));
		submit();
		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/init"));
		expect(mocks.email).toHaveBeenCalledOnce();
		expect(mocks.email.mock.calls[0][1].headers).toEqual({
			"x-captcha-response": "unit-challenge-two",
		});
		vi.unstubAllGlobals();
	});
});
