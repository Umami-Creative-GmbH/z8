/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	enabledProviders: [] as Array<{ id: string; name: string; icon: () => null }>,
	push: vi.fn(),
	signInSocial: vi.fn(),
	signUpEmail: vi.fn(),
	storePendingInviteCode: vi.fn(),
	storePendingInvitation: vi.fn(),
	useTurnstile: vi.fn(),
	validateInviteCode: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			defaultValue?: string,
			params?: Record<string, string | number>,
		) => {
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
	storePendingInviteCode: mocks.storePendingInviteCode,
	validateInviteCode: mocks.validateInviteCode,
}));

vi.mock("@/app/[locale]/(auth)/invitation-actions", () => ({
	storePendingInvitation: mocks.storePendingInvitation,
}));

vi.mock("@/lib/auth/domain-auth-context", () => ({
	useDomainAuth: () => null,
	useTurnstile: mocks.useTurnstile,
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		signIn: {
			social: mocks.signInSocial,
		},
		signUp: {
			email: mocks.signUpEmail,
		},
	},
}));

vi.mock("@/lib/hooks/use-enabled-providers", () => ({
	useEnabledProviders: () => ({
		enabledProviders: mocks.enabledProviders,
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
	useRouter: () => ({ push: mocks.push }),
}));

vi.mock("./auth-form-wrapper", () => ({
	AuthFormWrapper: ({
		children,
		formProps,
		title,
		...props
	}: {
		children: ReactNode;
		formProps?: React.ComponentProps<"form">;
		title: string;
		[key: string]: unknown;
	}) => (
		<form {...formProps} {...props}>
			<h1>{title}</h1>
			{children}
		</form>
	),
}));

vi.mock("./turnstile-widget", () => ({
	TurnstileWidget: () => <div>turnstile</div>,
}));

import { SignupForm } from "./signup-form";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function fillValidSignupForm() {
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
		target: { value: "Password1234" },
	});
	fireEvent.change(screen.getByLabelText("Confirm Password"), {
		target: { value: "Password1234" },
	});
}

describe("SignupForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.enabledProviders.length = 0;
		mocks.signUpEmail.mockResolvedValue({ error: null });
		mocks.storePendingInviteCode.mockResolvedValue(undefined);
		mocks.useTurnstile.mockReturnValue(null);
	});

	it("uses the setup password strength UI and validation rules", () => {
		render(<SignupForm />);

		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "Password123" },
		});

		expect(screen.getByText("12+ characters")).toBeTruthy();
		expect(screen.getByText("Uppercase letter")).toBeTruthy();
		expect(screen.getByText("Lowercase letter")).toBeTruthy();
		expect(screen.getByText("Number")).toBeTruthy();
		expect(
			screen.queryByText("Add one special character to finish."),
		).toBeNull();
		expect(
			screen.getByText("Password must be at least 12 characters"),
		).toBeTruthy();
	});

	it("uses setup-style inline confirmation validation", () => {
		render(<SignupForm />);

		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "Password1234" },
		});
		fireEvent.change(screen.getByLabelText("Confirm Password"), {
			target: { value: "Password1" },
		});

		expect(screen.getByText("Passwords do not match")).toBeTruthy();

		fireEvent.change(screen.getByLabelText("Confirm Password"), {
			target: { value: "Password1234" },
		});

		expect(screen.queryByText("Passwords do not match")).toBeNull();
	});

	it("focuses the first invalid field and associates its error on submit", async () => {
		render(<SignupForm />);

		fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

		const firstNameInput = screen.getByLabelText("First Name");
		await waitFor(() => {
			expect(document.activeElement).toBe(firstNameInput);
			expect(firstNameInput.getAttribute("aria-describedby")).toContain(
				"firstName-error",
			);
			expect(screen.getByText("First Name is required").id).toBe(
				"firstName-error",
			);
		});
	});

	it("uses example-style placeholders for the structured name fields", () => {
		render(<SignupForm />);

		expect(
			screen.getByLabelText("First Name").getAttribute("placeholder"),
		).toBe("John…");
		expect(screen.getByLabelText("Last Name").getAttribute("placeholder")).toBe(
			"Doe…",
		);
		expect(screen.getByLabelText("Email").getAttribute("placeholder")).toBe(
			"jane@example.com…",
		);
	});

	it("wires the last-name required error to the input on blur", () => {
		render(<SignupForm />);

		const lastNameInput = screen.getByLabelText("Last Name");

		fireEvent.blur(lastNameInput, {
			target: { value: "" },
		});

		const errorMessage = screen.getByText("Last Name is required");
		expect(errorMessage.id).toBe("lastName-error");
		expect(lastNameInput.getAttribute("aria-describedby")).toContain(
			"lastName-error",
		);
	});

	it("uses the required confirmation message for an empty confirm-password blur", () => {
		render(<SignupForm />);

		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "Password1234" },
		});
		fireEvent.blur(screen.getByLabelText("Confirm Password"), {
			target: { value: "" },
		});

		expect(screen.getByText("Please confirm your password")).toBeTruthy();
	});

	it("keeps submit available when turnstile is enabled and explains what is missing", async () => {
		mocks.useTurnstile.mockReturnValue({
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
			target: { value: "Password1234" },
		});
		fireEvent.change(screen.getByLabelText("Confirm Password"), {
			target: { value: "Password1234" },
		});

		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(
				screen.getByText("Please complete the verification."),
			).toBeTruthy();
		});
		expect(mocks.signUpEmail).not.toHaveBeenCalled();
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
			target: { value: "Password1234" },
		});
		fireEvent.change(screen.getByLabelText("Confirm Password"), {
			target: { value: "Password1234" },
		});

		fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

		await waitFor(() => {
			expect(mocks.signUpEmail).toHaveBeenCalledWith({
				email: "jamie@example.com",
				password: "Password1234",
				firstName: "Jamie",
				lastName: "Admin",
				name: "Jamie Admin",
			});
		});
	});

	it("keeps only the current invite-code validation result", async () => {
		const first = deferred<{
			success: true;
			data: { valid: true; inviteCode: { organization: { name: string } } };
		}>();
		const second = deferred<{
			success: true;
			data: { valid: true; inviteCode: { organization: { name: string } } };
		}>();
		mocks.validateInviteCode
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const { rerender } = render(<SignupForm inviteCode="CODE-A" />);
		await waitFor(() =>
			expect(mocks.validateInviteCode).toHaveBeenCalledWith("CODE-A"),
		);

		rerender(<SignupForm inviteCode="CODE-B" />);
		await waitFor(() =>
			expect(mocks.validateInviteCode).toHaveBeenCalledWith("CODE-B"),
		);
		await act(async () => {
			second.resolve({
				success: true,
				data: {
					valid: true,
					inviteCode: { organization: { name: "Organization B" } },
				},
			});
			await second.promise;
		});
		expect(await screen.findByText(/Organization B/)).toBeTruthy();

		await act(async () => {
			first.resolve({
				success: true,
				data: {
					valid: true,
					inviteCode: { organization: { name: "Organization A" } },
				},
			});
			await first.promise;
		});
		expect(screen.queryByText(/Organization A/)).toBeNull();
		expect(screen.getByText(/Organization B/)).toBeTruthy();
	});

	it("resets invite validity while a replacement code is pending", async () => {
		mocks.enabledProviders.push({
			id: "google",
			name: "Google",
			icon: () => null,
		});
		mocks.validateInviteCode
			.mockResolvedValueOnce({
				success: true,
				data: {
					valid: true,
					inviteCode: { organization: { name: "Organization A" } },
				},
			})
			.mockReturnValueOnce(new Promise(() => undefined));
		const { rerender, unmount } = render(<SignupForm inviteCode="CODE-A" />);
		expect(await screen.findByText(/Organization A/)).toBeTruthy();

		rerender(<SignupForm inviteCode="CODE-B" />);
		await waitFor(() =>
			expect(mocks.validateInviteCode).toHaveBeenCalledWith("CODE-B"),
		);
		expect(screen.queryByText(/Organization A/)).toBeNull();

		fireEvent.click(
			screen.getByRole("button", { name: "Sign up with Google" }),
		);
		await waitFor(() =>
			expect(mocks.signInSocial).toHaveBeenCalledWith({
				provider: "google",
				callbackURL: "/",
			}),
		);

		unmount();
		mocks.validateInviteCode.mockReturnValueOnce(new Promise(() => undefined));
		render(<SignupForm inviteCode="CODE-B" />);
		fillValidSignupForm();
		fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
		await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
		expect(mocks.storePendingInviteCode).not.toHaveBeenCalled();
	});

	it("does not forward auth-only props to the DOM", () => {
		render(
			<SignupForm
				callbackUrl="/dashboard"
				initialInvitationId="invitation-1"
				data-testid="signup-wrapper"
			/>,
		);

		const wrapper = screen.getByTestId("signup-wrapper");
		expect(wrapper.hasAttribute("callbackurl")).toBe(false);
		expect(wrapper.hasAttribute("initialinvitationid")).toBe(false);
	});
});
