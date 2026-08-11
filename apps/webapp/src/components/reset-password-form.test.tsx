/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	resetPassword: vi.fn(),
	searchParams: new URLSearchParams("token=reset-token"),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => mocks.searchParams,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: { resetPassword: mocks.resetPassword },
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
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

import { ResetPasswordForm } from "./reset-password-form";

function fillPasswordFields(password: string, confirmation: string) {
	fireEvent.change(screen.getByLabelText("New Password"), {
		target: { value: password },
	});
	fireEvent.change(screen.getByLabelText("Confirm New Password"), {
		target: { value: confirmation },
	});
}

describe("ResetPasswordForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.searchParams = new URLSearchParams("token=reset-token");
		mocks.resetPassword.mockResolvedValue({ error: null });
	});

	it("shows password and confirmation validation errors", async () => {
		render(<ResetPasswordForm />);
		fillPasswordFields("short", "different");

		fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));

		expect(
			await screen.findByText("Password must be at least 12 characters"),
		).toBeTruthy();
		expect(screen.getByText("Passwords do not match")).toBeTruthy();
		expect(mocks.resetPassword).not.toHaveBeenCalled();
	});

	it("submits the new password and shows the success state", async () => {
		render(<ResetPasswordForm />);
		fillPasswordFields("Password1234", "Password1234");

		fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));

		await waitFor(() => {
			expect(mocks.resetPassword).toHaveBeenCalledWith({
				newPassword: "Password1234",
				token: "reset-token",
			});
		});
		expect(await screen.findByText("Password reset successful")).toBeTruthy();
	});

	it("submits corrected values without requiring another blur", async () => {
		render(<ResetPasswordForm />);
		const passwordInput = screen.getByLabelText("New Password");
		const confirmationInput = screen.getByLabelText("Confirm New Password");

		fillPasswordFields("short", "different");
		fireEvent.blur(passwordInput);
		fireEvent.blur(confirmationInput);
		expect(
			await screen.findByText("Password must be at least 12 characters"),
		).toBeTruthy();

		fillPasswordFields("Password1234", "Password1234");
		fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));

		await waitFor(() => {
			expect(mocks.resetPassword).toHaveBeenCalledTimes(1);
		});
	});
});
