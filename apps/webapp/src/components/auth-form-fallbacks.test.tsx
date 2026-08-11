/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/to-have-text-content";

const testState = vi.hoisted(() => ({
	pending: new Promise<never>(() => undefined),
}));

function suspendForever(): never {
	throw testState.pending;
}

vi.mock("./login/login-form-content", () => ({
	LoginFormContent: suspendForever,
}));

vi.mock("next/navigation", () => ({
	useSearchParams: suspendForever,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children }: { children: React.ReactNode }) => (
		<a href="/">{children}</a>
	),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: { resetPassword: vi.fn() },
}));

import { LoginForm } from "./login-form";
import { ResetPasswordForm } from "./reset-password-form";

afterEach(cleanup);

function expectAuthFormLoading() {
	const loading = screen.getByRole("status");
	const label = loading.querySelector<HTMLElement>(".sr-only");
	expect(loading.getAttribute("aria-busy")).toBe("true");
	expect(label).not.toBeNull();
	if (label) {
		expect(label).toHaveTextContent("Loading authentication");
	}
}

describe("auth form fallbacks", () => {
	it("renders auth loading while login URL state suspends", () => {
		render(<LoginForm />);
		expectAuthFormLoading();
	});

	it("renders auth loading while reset-password URL state suspends", () => {
		render(<ResetPasswordForm />);
		expectAuthFormLoading();
	});
});
