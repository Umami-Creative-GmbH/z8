/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	configureNotificationsOnboarding: vi.fn(),
	push: vi.fn(),
	skipNotificationsSetup: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@/hooks/use-push-notifications", () => ({
	usePushNotifications: () => ({
		isLoading: false,
		isSupported: false,
		permission: "default",
		requestPermission: vi.fn(),
	}),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));

vi.mock("./actions", () => ({
	configureNotificationsOnboarding: mocks.configureNotificationsOnboarding,
	skipNotificationsSetup: mocks.skipNotificationsSetup,
}));

import NotificationsPage from "./page-client";

function deferred<T>() {
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((_resolve, rejectPromise) => {
		reject = rejectPromise;
	});
	return { promise, reject };
}

describe("NotificationsPage busy state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("keeps submit disabled after successful configuration navigation", async () => {
		mocks.configureNotificationsOnboarding.mockResolvedValue({ success: true });
		render(<NotificationsPage />);

		const continueButton = screen.getByRole("button", { name: "Continue" });
		fireEvent.click(continueButton);

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/complete"),
		);
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(continueButton).toHaveProperty("disabled", true);
	});

	it("submits the exact notification preference values", async () => {
		mocks.configureNotificationsOnboarding.mockResolvedValue({ success: true });
		render(<NotificationsPage />);

		fireEvent.click(
			screen.getByRole("switch", { name: "Email Notifications" }),
		);
		fireEvent.click(screen.getByRole("switch", { name: "Approval requests" }));
		fireEvent.click(screen.getByRole("switch", { name: "Team changes" }));
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		await waitFor(() =>
			expect(mocks.configureNotificationsOnboarding).toHaveBeenCalledWith({
				enablePush: false,
				enableEmail: false,
				notifyApprovals: false,
				notifyStatusUpdates: true,
				notifyTeamChanges: false,
			}),
		);
	});

	it("associates every notification switch with its visible label", () => {
		render(<NotificationsPage />);

		for (const name of [
			"Email Notifications",
			"Approval requests",
			"Status updates",
			"Team changes",
		]) {
			expect(screen.getByRole("switch", { name })).toBeTruthy();
		}
	});

	it("keeps skip disabled after successful skip navigation", async () => {
		mocks.skipNotificationsSetup.mockResolvedValue({ success: true });
		render(<NotificationsPage />);

		const skipButton = screen.getByRole("button", { name: "Skip for now" });
		fireEvent.click(skipButton);

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/complete"),
		);
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(skipButton).toHaveProperty("disabled", true);
	});

	it("resets submit loading and shows a safe error when configuration rejects", async () => {
		const request = deferred<never>();
		mocks.configureNotificationsOnboarding.mockReturnValue(request.promise);
		render(<NotificationsPage />);

		const continueButton = screen.getByRole("button", { name: "Continue" });
		fireEvent.click(continueButton);
		await waitFor(() =>
			expect(continueButton).toHaveProperty("disabled", true),
		);

		await act(async () =>
			request.reject(new Error("private configuration failure")),
		);

		await waitFor(() =>
			expect(continueButton).toHaveProperty("disabled", false),
		);
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Failed to save notification preferences",
		);
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("resets skip loading and shows a safe error when skipping rejects", async () => {
		const request = deferred<never>();
		mocks.skipNotificationsSetup.mockReturnValue(request.promise);
		render(<NotificationsPage />);

		const skipButton = screen.getByRole("button", { name: "Skip for now" });
		fireEvent.click(skipButton);
		await waitFor(() => expect(skipButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private skip failure")));

		await waitFor(() => expect(skipButton).toHaveProperty("disabled", false));
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Failed to skip notification setup",
		);
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});
});
