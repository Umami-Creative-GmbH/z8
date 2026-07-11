/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

class ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserver);

const {
	pushMock,
	resetTurnstileMock,
	signInEmailMock,
	useSearchParamsMock,
	useTurnstileMock,
	verifyTurnstileMock,
} = vi.hoisted(() => ({
	pushMock: vi.fn(),
	resetTurnstileMock: vi.fn(),
	signInEmailMock: vi.fn(),
	useSearchParamsMock: vi.fn(),
	useTurnstileMock: vi.fn(),
	verifyTurnstileMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: useSearchParamsMock,
}));

vi.mock("@/lib/auth/domain-auth-context", () => ({
	useDomainAuth: () => null,
	useTurnstile: useTurnstileMock,
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		signIn: {
			email: signInEmailMock,
			passkey: vi.fn(),
			social: vi.fn(),
			sso: vi.fn(),
		},
		twoFactor: {
			verifyTotp: vi.fn(),
		},
	},
}));

vi.mock("@/lib/hooks/use-enabled-providers", () => ({
	useEnabledProviders: () => ({ enabledProviders: [], isLoading: false }),
}));

vi.mock("@/lib/turnstile/verify", () => ({
	verifyTurnstileWithServer: verifyTurnstileMock,
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
	useRouter: () => ({ push: pushMock }),
}));

vi.mock("../auth-form-wrapper", () => ({
	AuthFormWrapper: ({ children, formProps }: { children: ReactNode; formProps?: React.ComponentProps<"form"> }) => (
		<form {...formProps}>{children}</form>
	),
}));

vi.mock("../turnstile-widget", () => ({
	TurnstileWidget: ({
		onVerify,
		ref,
	}: {
		onVerify: (token: string) => void;
		ref?: (instance: { reset: () => void } | null) => void;
	}) => {
		ref?.({ reset: resetTurnstileMock });
		return <button type="button" onClick={() => onVerify("turnstile-token")}>Complete verification</button>;
	},
}));

import { LoginFormContent } from "./login-form-content";

function fillCredentials() {
	fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
	fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
}

function submitCredentials() {
	fireEvent.click(screen.getByRole("button", { name: "Login" }));
}

describe("LoginFormContent", () => {
	beforeEach(() => {
		pushMock.mockReset();
		resetTurnstileMock.mockReset();
		signInEmailMock.mockReset();
		signInEmailMock.mockResolvedValue({ error: null });
		useSearchParamsMock.mockReturnValue(new URLSearchParams());
		useTurnstileMock.mockReset();
		useTurnstileMock.mockReturnValue(null);
		verifyTurnstileMock.mockReset();
		verifyTurnstileMock.mockResolvedValue({ success: true });
		vi.stubGlobal("fetch", vi.fn());
	});

	it("renders two-factor authentication after an email sign-in requires it", async () => {
		signInEmailMock.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });

		render(<LoginFormContent />);
		fillCredentials();
		submitCredentials();

		await waitFor(() => {
			expect(screen.getByText("Two-Factor Authentication Code")).toBeTruthy();
		});
	});

	it("resets Turnstile when server verification fails", async () => {
		useTurnstileMock.mockReturnValue({ enabled: true, siteKey: "site-key" });
		verifyTurnstileMock.mockResolvedValue({ success: false, error: "Verification failed." });

		render(<LoginFormContent />);
		fireEvent.click(screen.getByRole("button", { name: "Complete verification" }));
		fillCredentials();
		submitCredentials();

		await waitFor(() => {
			expect(resetTurnstileMock).toHaveBeenCalledOnce();
		});
		expect(signInEmailMock).not.toHaveBeenCalled();
	});

	it("routes incomplete onboarding to its saved step", async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ onboardingComplete: false, onboardingStep: "profile" }),
		} as Response);

		render(<LoginFormContent />);
		fillCredentials();
		submitCredentials();

		await waitFor(() => {
			expect(pushMock).toHaveBeenCalledWith("/onboarding/profile");
		});
	});

	it("uses the sanitized callback redirect after completed onboarding", async () => {
		useSearchParamsMock.mockReturnValue(new URLSearchParams("callbackUrl=https://attacker.example"));
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ onboardingComplete: true, onboardingStep: null }),
		} as Response);

		render(<LoginFormContent />);
		fillCredentials();
		submitCredentials();

		await waitFor(() => {
			expect(pushMock).toHaveBeenCalledWith("/init");
		});
	});
});
