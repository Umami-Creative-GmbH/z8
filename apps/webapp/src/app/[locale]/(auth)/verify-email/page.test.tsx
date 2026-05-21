/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VerifyEmailPage from "./page";

const { pushMock, searchParams } = vi.hoisted(() => ({
	pushMock: vi.fn(),
	searchParams: new URLSearchParams("token=token_1"),
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
	AuthFormWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
		<section aria-label={title}>{children}</section>
	),
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		verifyEmail: vi.fn().mockResolvedValue({}),
	},
}));

vi.mock("@/app/[locale]/(auth)/invite-code-actions", () => ({
	processPendingInviteCode: vi.fn().mockResolvedValue({ success: false }),
}));

vi.mock("@/app/[locale]/(auth)/invitation-actions", () => ({
	getPendingInvitation: vi.fn().mockResolvedValue({ success: false }),
}));

describe("VerifyEmailPage", () => {
	afterEach(() => {
		pushMock.mockClear();
		vi.restoreAllMocks();
	});

	it("cancels the delayed redirect when unmounted", async () => {
		const originalSetTimeout = window.setTimeout;
		let redirectTimer: ReturnType<typeof setTimeout> | undefined;
		const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
		vi.spyOn(window, "setTimeout").mockImplementation((handler, timeout, ...args) => {
			const timer = originalSetTimeout(handler, timeout, ...args);
			if (timeout === 3000) {
				redirectTimer = timer;
			}
			return timer;
		});

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
});
