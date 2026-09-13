/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestPasswordReset: vi.fn(), useTurnstile: vi.fn(), verify: vi.fn(), reset: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("@/lib/auth/domain-auth-context", () => ({ useTurnstile: mocks.useTurnstile }));
vi.mock("@/lib/auth-client", () => ({ authClient: { requestPasswordReset: mocks.requestPasswordReset } }));
vi.mock("@/lib/turnstile/verify", () => ({ verifyTurnstileWithServer: mocks.verify }));
vi.mock("@/navigation", () => ({ Link: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("./auth-form-wrapper", () => ({ AuthFormWrapper: ({ children, formProps }: { children: ReactNode; formProps?: ComponentProps<"form"> }) => <form {...formProps}>{children}</form> }));
vi.mock("./turnstile-widget", () => ({
	TurnstileWidget: ({ ref, onVerify }: { ref: RefObject<{ reset: () => void } | null>; onVerify: (token: string) => void }) => {
		ref.current = { reset: mocks.reset };
		return <button type="button" onClick={() => onVerify("reset-token")}>Complete verification</button>;
	},
}));

import { ForgotPasswordForm } from "./forgot-password-form";

function submit() {
	fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
	const form = screen.getByLabelText("Email").closest("form");
	if (!form) throw new Error("Missing password reset form");
	fireEvent.submit(form);
}

describe("ForgotPasswordForm CAPTCHA request", () => {
	afterEach(cleanup);
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requestPasswordReset.mockResolvedValue({ error: null });
		mocks.verify.mockResolvedValue({ success: true });
		mocks.useTurnstile.mockReturnValue({ enabled: true, siteKey: "site-key" });
	});
	it("sends the token with password reset and never verifies independently", async () => {
		render(<ForgotPasswordForm />);
		fireEvent.click(screen.getByRole("button", { name: "Complete verification" }));
		submit();
		await waitFor(() => expect(mocks.requestPasswordReset).toHaveBeenCalledOnce());
		expect(mocks.requestPasswordReset.mock.calls[0][0]).toMatchObject({
			email: "person@example.com",
			fetchOptions: { headers: { "x-captcha-response": "reset-token" } },
		});
		expect(mocks.verify).not.toHaveBeenCalled();
		await screen.findByText(/If an account exists/);
	});
	it("resets the consumed token and shows the auth request failure for retry", async () => {
		mocks.requestPasswordReset.mockResolvedValue({ error: { code: "TURNSTILE_FAILED", message: "Verification failed." } });
		render(<ForgotPasswordForm />);
		fireEvent.click(screen.getByRole("button", { name: "Complete verification" }));
		submit();
		await screen.findByText("Verification failed.");
		expect(mocks.reset).toHaveBeenCalledOnce();
		expect((screen.getByRole("button", { name: "Send reset link" }) as HTMLButtonElement).disabled).toBe(true);
	});
	it("prevents submission without a required token", async () => {
		render(<ForgotPasswordForm />);
		submit();
		await screen.findByText("Please complete the verification.");
		expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
	});
	it("allows CAPTCHA-disabled reset without a token", async () => {
		mocks.useTurnstile.mockReturnValue(null);
		render(<ForgotPasswordForm />);
		submit();
		await screen.findByText(/If an account exists/);
		expect(mocks.requestPasswordReset.mock.calls[0][0].fetchOptions).toBeUndefined();
		expect(mocks.verify).not.toHaveBeenCalled();
	});
	it("validates email before submitting and connects errors to the field", async () => {
		mocks.useTurnstile.mockReturnValue(null);
		render(<ForgotPasswordForm />);
		const input = screen.getByLabelText("Email");
		fireEvent.change(input, { target: { value: "invalid" } });
		fireEvent.blur(input);
		await screen.findByText("Invalid email address");
		expect(input.getAttribute("aria-invalid")).toBe("true");
		const form = input.closest("form");
		if (!form) throw new Error("Missing password reset form");
		fireEvent.submit(form);
		expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
	});
});
