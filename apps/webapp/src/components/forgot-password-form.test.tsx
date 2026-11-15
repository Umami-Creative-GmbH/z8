/* @vitest-environment jsdom */
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode, RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requestPasswordReset: vi.fn(),
	useTurnstile: vi.fn(),
	useBranding: vi.fn(),
	verify: vi.fn(),
	reset: vi.fn(),
	token: "reset-token",
	locale: "en",
	load: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
	useTolgee: () => ({ getLanguage: () => mocks.locale }),
}));
vi.mock("@/lib/auth/domain-auth-context", () => ({
	useTurnstile: mocks.useTurnstile,
	useBranding: mocks.useBranding,
}));
vi.mock("@/lib/auth/auth-page-client", () => ({
	authPageClient: { requestPasswordReset: mocks.requestPasswordReset },
}));
vi.mock("@/lib/auth/load-auth-page-client", () => ({
	loadAuthPageClient: mocks.load,
}));
vi.mock("@/lib/turnstile/verify", () => ({
	verifyTurnstileWithServer: mocks.verify,
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("./turnstile-widget", () => ({
	TurnstileWidget: ({
		ref,
		onVerify,
		onExpire,
	}: {
		ref: RefObject<{ reset: () => void } | null>;
		onVerify: (token: string) => void;
		onExpire: () => void;
	}) => {
		ref.current = { reset: mocks.reset };
		return (
			<>
				<button type="button" onClick={() => onVerify(mocks.token)}>
					Complete verification
				</button>
				<button type="button" onClick={onExpire}>
					Expire verification
				</button>
			</>
		);
	},
}));

import { ForgotPasswordForm } from "./forgot-password-form";

function submit() {
	fireEvent.change(screen.getByLabelText("Email"), {
		target: { value: "person@example.com" },
	});
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
		mocks.useBranding.mockReturnValue({
			appName: "Owned recovery workspace",
			primaryColor: "#2563eb",
		});
		mocks.token = "reset-token";
		mocks.locale = "en";
		mocks.load.mockResolvedValue({
			requestPasswordReset: mocks.requestPasswordReset,
		});
	});
	it("does not send a token that expires while the auth client loads", async () => {
		let loaded: (client: {
			requestPasswordReset: typeof mocks.requestPasswordReset;
		}) => void = () => {
			throw new Error("Missing load");
		};
		mocks.load.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					loaded = resolve;
				}),
		);
		render(<ForgotPasswordForm />);
		fireEvent.click(
			screen.getByRole("button", { name: "Complete verification" }),
		);
		submit();
		await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
		fireEvent.click(
			screen.getByRole("button", { name: "Expire verification" }),
		);
		await act(async () =>
			loaded({ requestPasswordReset: mocks.requestPasswordReset }),
		);
		expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
		await screen.findByText("Please complete the verification.");
		expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
			"person@example.com",
		);
	});
	it("sends the latest verification when it refreshes during client loading", async () => {
		let loaded: (client: {
			requestPasswordReset: typeof mocks.requestPasswordReset;
		}) => void = () => {
			throw new Error("Missing load");
		};
		mocks.load.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					loaded = resolve;
				}),
		);
		render(<ForgotPasswordForm />);
		fireEvent.click(
			screen.getByRole("button", { name: "Complete verification" }),
		);
		submit();
		await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
		mocks.token = "refreshed-during-import";
		fireEvent.click(
			screen.getByRole("button", { name: "Complete verification" }),
		);
		await act(async () =>
			loaded({ requestPasswordReset: mocks.requestPasswordReset }),
		);
		await screen.findByText(/If an account exists/);
		expect(
			mocks.requestPasswordReset.mock.calls[0][0].fetchOptions.headers[
				"x-captcha-response"
			],
		).toBe("refreshed-during-import");
		expect(mocks.verify).not.toHaveBeenCalled();
	});
	it("validates an empty submission and focuses the email field", async () => {
		mocks.useTurnstile.mockReturnValue(null);
		render(<ForgotPasswordForm />);
		const input = screen.getByLabelText("Email");
		const form = input.closest("form");
		if (!form) throw new Error("Missing form");
		fireEvent.submit(form);
		await screen.findByText("Invalid email address");
		expect(document.activeElement).toBe(input);
		expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
	});
	it("focuses invalid email on submit without sending a request", async () => {
		mocks.useTurnstile.mockReturnValue(null);
		render(<ForgotPasswordForm />);
		const input = screen.getByLabelText("Email");
		fireEvent.change(input, { target: { value: "invalid" } });
		const button = screen.getByRole("button", { name: "Send reset link" });
		button.focus();
		const form = input.closest("form");
		if (!form) throw new Error("Missing form");
		fireEvent.submit(form);
		await waitFor(() => expect(document.activeElement).toBe(input));
		expect(screen.getByRole("alert").textContent).toBe("Invalid email address");
		expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
	});
	it("keeps resolved domain branding before and after the neutral outcome", async () => {
		render(<ForgotPasswordForm />);
		expect(screen.getByText("Owned recovery workspace")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Complete verification" }),
		);
		submit();
		await screen.findByText(/If an account exists/);
		expect(screen.getByText("Owned recovery workspace")).toBeTruthy();
		expect(screen.queryByLabelText("Email")).toBeNull();
		expect(
			screen.getByRole("link", { name: "Back to login" }).getAttribute("href"),
		).toBe("/sign-in");
	});
	it("sends the token with password reset and never verifies independently", async () => {
		render(<ForgotPasswordForm />);
		fireEvent.click(
			screen.getByRole("button", { name: "Complete verification" }),
		);
		submit();
		await waitFor(() =>
			expect(mocks.requestPasswordReset).toHaveBeenCalledOnce(),
		);
		expect(mocks.requestPasswordReset.mock.calls[0][0]).toMatchObject({
			email: "person@example.com",
			fetchOptions: { headers: { "x-captcha-response": "reset-token" } },
		});
		expect(mocks.verify).not.toHaveBeenCalled();
		await screen.findByText(/If an account exists/);
	});
	it("announces pending, prevents native re-entry, retains failure input and retries with a fresh token on the localized request", async () => {
		let finish: (value: { error: { message: string } }) => void = () => {
			throw new Error("Missing request");
		};
		mocks.locale = "de";
		mocks.requestPasswordReset.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		render(<ForgotPasswordForm />);
		fireEvent.click(
			screen.getByRole("button", { name: "Complete verification" }),
		);
		submit();
		await waitFor(() =>
			expect(mocks.requestPasswordReset).toHaveBeenCalledOnce(),
		);
		const input = screen.getByLabelText("Email");
		const form = input.closest("form");
		if (!form) throw new Error("Missing form");
		expect(form.getAttribute("aria-busy")).toBe("true");
		expect(screen.getByRole("status").textContent).toContain(
			"Sending reset link",
		);
		fireEvent.submit(form);
		fireEvent.submit(form);
		expect(mocks.requestPasswordReset).toHaveBeenCalledOnce();
		await act(async () =>
			finish({ error: { message: "Please retry the request." } }),
		);
		await screen.findByText("Please retry the request.");
		expect((input as HTMLInputElement).value).toBe("person@example.com");
		expect(mocks.reset).toHaveBeenCalledOnce();
		expect(
			(
				screen.getByRole("button", {
					name: "Send reset link",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		mocks.token = "fresh-retry-token";
		fireEvent.click(
			screen.getByRole("button", { name: "Complete verification" }),
		);
		fireEvent.submit(form);
		await screen.findByText(/If an account exists/);
		expect(mocks.requestPasswordReset).toHaveBeenCalledTimes(2);
		expect(mocks.requestPasswordReset.mock.calls[1][0]).toEqual({
			email: "person@example.com",
			redirectTo: `${window.location.origin}/de/reset-password`,
			fetchOptions: { headers: { "x-captcha-response": "fresh-retry-token" } },
		});
		expect(mocks.verify).not.toHaveBeenCalled();
	});
	it("resets the consumed token and shows the auth request failure for retry", async () => {
		mocks.requestPasswordReset.mockResolvedValue({
			error: { code: "TURNSTILE_FAILED", message: "Verification failed." },
		});
		render(<ForgotPasswordForm />);
		fireEvent.click(
			screen.getByRole("button", { name: "Complete verification" }),
		);
		submit();
		await screen.findByText("Verification failed.");
		expect(mocks.reset).toHaveBeenCalledOnce();
		expect(
			(
				screen.getByRole("button", {
					name: "Send reset link",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
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
		expect(
			mocks.requestPasswordReset.mock.calls[0][0].fetchOptions,
		).toBeUndefined();
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
