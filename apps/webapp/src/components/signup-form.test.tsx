/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, signInSocialMock, signUpEmailMock, useTurnstileMock } = vi.hoisted(() => ({
	pushMock: vi.fn(),
	signInSocialMock: vi.fn(),
	signUpEmailMock: vi.fn(),
	useTurnstileMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, params?: Record<string, string | number>) => {
			if (!defaultValue) {
				return _key;
			}

			return defaultValue.replace(/\{(\w+)\}/g, (_, token: string) =>
				String(params?.[token] ?? `{${token}}`),
			);
		},
	}),
}));

vi.mock("@/app/[locale]/(auth)/invite-code-actions", () => ({
	storePendingInviteCode: vi.fn(),
	validateInviteCode: vi.fn(),
}));

vi.mock("@/app/[locale]/(auth)/invitation-actions", () => ({
	storePendingInvitation: vi.fn(),
}));

vi.mock("@/lib/auth/domain-auth-context", () => ({
	useDomainAuth: () => null,
	useTurnstile: useTurnstileMock,
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		signIn: {
			social: signInSocialMock,
		},
		signUp: {
			email: signUpEmailMock,
		},
	},
}));

vi.mock("@/lib/hooks/use-enabled-providers", () => ({
	useEnabledProviders: () => ({
		enabledProviders: [],
		isLoading: false,
	}),
}));

vi.mock("@/lib/turnstile/verify", () => ({
	verifyTurnstileWithServer: vi.fn(),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: pushMock }),
}));

vi.mock("./auth-form-wrapper", () => ({
	AuthFormWrapper: ({
		children,
		formProps,
		title,
	}: {
		children: ReactNode;
		formProps?: React.ComponentProps<"form">;
		title: string;
	}) => (
		<form {...formProps}>
			<h1>{title}</h1>
			{children}
		</form>
	),
}));

vi.mock("./turnstile-widget", () => ({
	TurnstileWidget: () => <div>turnstile</div>,
}));

import { SignupForm } from "./signup-form";

describe("SignupForm", () => {
	beforeEach(() => {
		pushMock.mockReset();
		signInSocialMock.mockReset();
		signUpEmailMock.mockReset();
		signUpEmailMock.mockResolvedValue({ error: null });
		useTurnstileMock.mockReset();
		useTurnstileMock.mockReturnValue(null);
	});

	it("shows live password progress while the user builds a valid password", () => {
		render(<SignupForm />);

		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "Password1" },
		});

		expect(screen.getByText("4 of 5 requirements met")).toBeTruthy();
		expect(screen.getByText("Add one special character to finish.")).toBeTruthy();
		expect(screen.getByLabelText("Password").getAttribute("aria-describedby")).toContain(
			"password-guidance",
		);
		expect(
			screen.getByText("4 of 5 requirements met").closest('[aria-live="polite"]'),
		).toBeTruthy();
	});

	it("shows live confirmation feedback before submit", () => {
		render(<SignupForm />);

		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "Password1!" },
		});
		fireEvent.change(screen.getByLabelText("Confirm Password"), {
			target: { value: "Password1" },
		});

		expect(screen.getByText("Keep typing to match your password exactly.")).toBeTruthy();

		fireEvent.change(screen.getByLabelText("Confirm Password"), {
			target: { value: "Password1!" },
		});

		expect(
			screen.getByText("Confirmation matches and your password is ready to use."),
		).toBeTruthy();
		expect(
			screen
				.getByText("Confirmation matches and your password is ready to use.")
				.getAttribute("aria-live"),
		).toBe("polite");
		expect(screen.getByLabelText("Confirm Password").getAttribute("aria-describedby")).toContain(
			"confirm-password-status",
		);
	});

	it("focuses the first invalid field and associates its error on submit", async () => {
		render(<SignupForm />);

		fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

		const firstNameInput = screen.getByLabelText("First Name");
		await waitFor(() => {
			expect(document.activeElement).toBe(firstNameInput);
			expect(firstNameInput.getAttribute("aria-describedby")).toContain("firstName-error");
			expect(screen.getByText("First Name is required").id).toBe("firstName-error");
		});
	});

	it("uses example-style placeholders for the structured name fields", () => {
		render(<SignupForm />);

		expect(screen.getByLabelText("First Name").getAttribute("placeholder")).toBe("John…");
		expect(screen.getByLabelText("Last Name").getAttribute("placeholder")).toBe("Doe…");
		expect(screen.getByLabelText("Email").getAttribute("placeholder")).toBe("jane@example.com…");
	});

	it("wires the last-name required error to the input on blur", () => {
		render(<SignupForm />);

		const lastNameInput = screen.getByLabelText("Last Name");

		fireEvent.blur(lastNameInput, {
			target: { value: "" },
		});

		const errorMessage = screen.getByText("Last Name is required");
		expect(errorMessage.id).toBe("lastName-error");
		expect(lastNameInput.getAttribute("aria-describedby")).toContain("lastName-error");
	});

	it("uses the required confirmation message for an empty confirm-password blur", () => {
		render(<SignupForm />);

		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "Password1!" },
		});
		fireEvent.blur(screen.getByLabelText("Confirm Password"), {
			target: { value: "" },
		});

		expect(screen.getByText("Please confirm your password")).toBeTruthy();
	});

	it("keeps submit available when turnstile is enabled and explains what is missing", async () => {
		useTurnstileMock.mockReturnValue({
			enabled: true,
			siteKey: "site-key",
		});

		render(<SignupForm />);

		const submitButton = screen.getByRole("button", { name: "Sign up" });
		expect(submitButton.hasAttribute("disabled")).toBe(false);
		fireEvent.change(screen.getByLabelText("First Name"), {
			target: { value: "Jamie" },
		});
		fireEvent.change(screen.getByLabelText("Last Name"), {
			target: { value: "Admin" },
		});
		fireEvent.change(screen.getByLabelText("Email"), {
			target: { value: "jamie@example.com" },
		});
		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "Password1!" },
		});
		fireEvent.change(screen.getByLabelText("Confirm Password"), {
			target: { value: "Password1!" },
		});

		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(screen.getByText("Please complete the verification.")).toBeTruthy();
		});
		expect(signUpEmailMock).not.toHaveBeenCalled();
		expect(submitButton.hasAttribute("disabled")).toBe(false);
		expect(screen.queryByText("Loading…")).toBeNull();
	});

	it("passes structured names and the derived name to Better Auth", async () => {
		render(<SignupForm />);

		fireEvent.change(screen.getByLabelText("First Name"), {
			target: { value: "  Jamie  " },
		});
		fireEvent.change(screen.getByLabelText("Last Name"), {
			target: { value: "  Admin  " },
		});
		fireEvent.change(screen.getByLabelText("Email"), {
			target: { value: "jamie@example.com" },
		});
		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "Password1!" },
		});
		fireEvent.change(screen.getByLabelText("Confirm Password"), {
			target: { value: "Password1!" },
		});

		fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

		await waitFor(() => {
			expect(signUpEmailMock).toHaveBeenCalledWith({
				email: "jamie@example.com",
				password: "Password1!",
				firstName: "Jamie",
				lastName: "Admin",
				name: "Jamie Admin",
			});
		});
	});
});
