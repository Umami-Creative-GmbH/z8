/* @vitest-environment jsdom */

import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authClient } from "@/lib/auth-client";
import VerifyEmailPage from "./page";

const {
	getPendingInvitationMock,
	processPendingInviteCodeMock,
	pushMock,
	searchParams,
	verifyEmailMock,
} = vi.hoisted(() => ({
	getPendingInvitationMock: vi.fn(),
	processPendingInviteCodeMock: vi.fn(),
	pushMock: vi.fn(),
	searchParams: new URLSearchParams("token=token_1"),
	verifyEmailMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => searchParams,
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({
		push: pushMock,
	}),
}));

vi.mock("@/components/auth-form-wrapper", () => ({
	AuthFormWrapper: ({
		title,
		children,
	}: {
		title: string;
		children: ReactNode;
	}) => <section aria-label={title}>{children}</section>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({
		children,
		...props
	}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		verifyEmail: verifyEmailMock,
	},
}));

vi.mock("@/app/[locale]/(auth)/invite-code-actions", () => ({
	processPendingInviteCode: processPendingInviteCodeMock,
}));

vi.mock("@/app/[locale]/(auth)/invitation-actions", () => ({
	getPendingInvitation: getPendingInvitationMock,
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("VerifyEmailPage", () => {
	beforeEach(() => {
		searchParams.set("token", "token_1");
		verifyEmailMock.mockResolvedValue({});
		processPendingInviteCodeMock.mockResolvedValue({ success: false });
		getPendingInvitationMock.mockResolvedValue({ success: false });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it("cancels the delayed redirect when unmounted", async () => {
		const originalSetTimeout = window.setTimeout;
		let redirectTimer: ReturnType<typeof setTimeout> | undefined;
		const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
		vi.spyOn(window, "setTimeout").mockImplementation(
			(handler, timeout, ...args) => {
				const timer = originalSetTimeout(handler, timeout, ...args);
				if (timeout === 3000) {
					redirectTimer = timer;
				}
				return timer;
			},
		);

		const { unmount } = render(<VerifyEmailPage />);

		await waitFor(() => {
			expect(
				screen.getByText(
					"Your email has been successfully verified. You can now sign in to your account.",
				),
			).toBeTruthy();
		});

		unmount();

		expect(redirectTimer).toBeDefined();
		expect(clearTimeoutSpy).toHaveBeenCalledWith(redirectTimer);
	});

	it("verifies the token only once while rendering the success state", async () => {
		render(<VerifyEmailPage />);

		await waitFor(() => {
			expect(
				screen.getByText(
					"Your email has been successfully verified. You can now sign in to your account.",
				),
			).toBeTruthy();
		});

		expect(authClient.verifyEmail).toHaveBeenCalledTimes(1);
	});

	it("ignores an earlier verification result after the token changes", async () => {
		const first = deferred<{ error?: { message: string } }>();
		const second = deferred<Record<string, never>>();
		verifyEmailMock.mockReset();
		verifyEmailMock
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);

		const { rerender } = render(<VerifyEmailPage />);
		await waitFor(() => expect(verifyEmailMock).toHaveBeenCalledOnce());

		searchParams.set("token", "token_2");
		rerender(<VerifyEmailPage />);
		await waitFor(() => expect(verifyEmailMock).toHaveBeenCalledTimes(2));

		await act(async () => {
			second.resolve({});
			await second.promise;
		});
		expect(await screen.findByLabelText("Email Verified!")).toBeTruthy();

		await act(async () => {
			first.resolve({ error: { message: "Stale verification failure" } });
			await first.promise;
		});

		expect(screen.getByLabelText("Email Verified!")).toBeTruthy();
		expect(screen.queryByText("Stale verification failure")).toBeNull();
	});

	it("hides the previous token success state while the next token verifies", async () => {
		const second = deferred<Record<string, never>>();
		verifyEmailMock.mockReset();
		verifyEmailMock
			.mockResolvedValueOnce({})
			.mockReturnValueOnce(second.promise);
		processPendingInviteCodeMock.mockResolvedValueOnce({
			success: true,
			data: {
				success: true,
				status: "approved",
				organizationName: "Organization A",
			},
		});

		const { rerender } = render(<VerifyEmailPage />);
		expect(
			await screen.findByRole("button", { name: "Continue Setup" }),
		).toBeTruthy();
		expect(screen.getByText("You've joined {organization}!")).toBeTruthy();

		searchParams.set("token", "token_2");
		rerender(<VerifyEmailPage />);

		expect(screen.getByLabelText("Verifying your email...")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Continue Setup" })).toBeNull();
		expect(screen.queryByText("You've joined {organization}!")).toBeNull();
		expect(verifyEmailMock).toHaveBeenLastCalledWith({
			query: { token: "token_2" },
		});
	});

	it("renders loading in the token-change commit before passive effects", async () => {
		const second = deferred<Record<string, never>>();
		verifyEmailMock.mockReset();
		verifyEmailMock
			.mockResolvedValueOnce({})
			.mockReturnValueOnce(second.promise);
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () => root.render(<VerifyEmailPage />));
		expect(await screen.findByLabelText("Email Verified!")).toBeTruthy();

		searchParams.set("token", "token_2");
		act(() => {
			flushSync(() => root.render(<VerifyEmailPage />));
			expect(screen.getByLabelText("Verifying your email...")).toBeTruthy();
			expect(screen.queryByLabelText("Email Verified!")).toBeNull();
		});
		await act(async () => root.unmount());
		container.remove();
	});

	it("does not run an old token redirect after the new token commits", async () => {
		vi.useFakeTimers();
		const second = deferred<Record<string, never>>();
		verifyEmailMock.mockReset();
		verifyEmailMock
			.mockResolvedValueOnce({})
			.mockReturnValueOnce(second.promise);
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(<VerifyEmailPage />);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		searchParams.set("token", "token_2");
		act(() => {
			flushSync(() => root.render(<VerifyEmailPage />));
			vi.advanceTimersByTime(3000);
			expect(pushMock).not.toHaveBeenCalled();
		});
		await act(async () => root.unmount());
		container.remove();
		vi.useRealTimers();
	});
});
