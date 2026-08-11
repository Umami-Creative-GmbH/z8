/* @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
	pending: new Promise<never>(() => undefined),
}));

function suspendForever(): never {
	throw testState.pending;
}

vi.mock("@/components/login-form", () => ({ LoginForm: suspendForever }));
vi.mock("@/components/reset-password-form", () => ({
	ResetPasswordForm: suspendForever,
}));
vi.mock("@/components/signup-form", () => ({ SignupForm: suspendForever }));

vi.mock("next/navigation", () => ({
	useSearchParams: suspendForever,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) =>
			key === "common:loading.authentication"
				? "Anmeldung wird geladen"
				: fallback,
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children }: { children: React.ReactNode }) => (
		<a href="/">{children}</a>
	),
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: { verifyEmail: vi.fn() },
	useSession: () => ({ data: null }),
}));

vi.mock("@/app/[locale]/(auth)/invite-code-actions", () => ({
	processPendingInviteCode: vi.fn(),
}));

vi.mock("@/app/[locale]/(auth)/invitation-actions", () => ({
	getPendingInvitation: vi.fn(),
}));

import ResetPasswordPage from "./reset-password/page";
import SignInPage from "./sign-in/page";
import SignUpPage from "./sign-up/page";
import VerifyEmailPage from "./verify-email/page";
import VerifyEmailPendingPage from "./verify-email-pending/page";

afterEach(cleanup);

function expectNeutralAuthLoading() {
	const loading = screen.getByRole("status");
	expect(loading.getAttribute("aria-busy")).toBe("true");
	expect(screen.getByText("Anmeldung wird geladen")).toBeTruthy();
	expect(screen.queryByText(/organization|tenant|email/i)).toBeNull();
}

describe("primary auth route fallbacks", () => {
	it("renders auth loading while sign-in content suspends", async () => {
		await act(async () => render(<SignInPage />));
		expectNeutralAuthLoading();
	});

	it("renders auth loading while sign-up URL data is unresolved", async () => {
		await act(async () =>
			render(<SignUpPage searchParams={testState.pending} />),
		);
		expectNeutralAuthLoading();
	});

	it("renders auth loading while reset-password content suspends", async () => {
		await act(async () => render(<ResetPasswordPage />));
		expectNeutralAuthLoading();
	});

	it("renders auth loading while verify-email URL state suspends", async () => {
		await act(async () => render(<VerifyEmailPage />));
		expectNeutralAuthLoading();
	});

	it("renders auth loading while pending-verification URL state suspends", async () => {
		await act(async () => render(<VerifyEmailPendingPage />));
		expectNeutralAuthLoading();
	});
});
