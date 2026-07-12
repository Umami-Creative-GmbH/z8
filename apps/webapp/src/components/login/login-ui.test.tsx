/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

class ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserver);

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { LoginAlternativeAuth } from "./alternative-auth";
import { LoginCredentialsFields } from "./credentials-fields";
import { LoginActions } from "./login-actions";
import { TwoFactorForm } from "./two-factor-form";

describe("login UI sections", () => {
	it("disables credentials during two-factor authentication", () => {
		render(
			<LoginCredentialsFields
				email="person@example.com"
				password="password"
				fieldErrors={{}}
				requires2FA
				onEmailBlur={vi.fn()}
				onEmailChange={vi.fn()}
				onPasswordBlur={vi.fn()}
				onPasswordChange={vi.fn()}
			/>,
		);

		expect(screen.getByLabelText("Email")).toHaveProperty("disabled", true);
		expect(screen.getByLabelText("Password")).toHaveProperty("disabled", true);
	});

	it("hides alternative authentication during two-factor authentication", () => {
		const { container } = render(
			<LoginAlternativeAuth
				requires2FA
				showPasskey
				filteredProviders={[]}
				providersLoading={false}
				isLoading={false}
				onPasskeyLogin={vi.fn()}
				onSocialLogin={vi.fn()}
			/>,
		);

		expect(container.firstChild).toBeNull();
	});

	it("disables two-factor verification until all six digits are entered", () => {
		const props = {
			trustDevice: false,
			isLoading: false,
			onOtpChange: vi.fn(),
			onTrustDeviceChange: vi.fn(),
			onVerify: vi.fn(),
		};
		const { rerender } = render(
			<TwoFactorForm
				otpValue="12345"
				{...props}
			/>,
		);

		expect(screen.getByRole("button", { name: "Verify and Login" })).toHaveProperty("disabled", true);
		rerender(<TwoFactorForm otpValue="123456" {...props} />);
		expect(screen.getByRole("button", { name: "Verify and Login" })).toHaveProperty("disabled", false);
	});

	it("disables email login until Turnstile has a token", () => {
		render(
			<LoginActions
				requires2FA={false}
				showEmailPassword
				isLoading={false}
				turnstile={{
					config: { enabled: true, siteKey: "site-key" },
					token: null,
				}}
				forgotPasswordHref="/forgot-password"
				signUpHref="/sign-up"
			>
				<div>Alternative authentication</div>
			</LoginActions>,
		);

		expect(screen.getByRole("button", { name: "Login" })).toHaveProperty("disabled", true);
	});
});
