/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
	configureWellnessOnboardingMock,
	pushMock,
	skipWellnessSetupMock,
	toastErrorMock,
	toastSuccessMock,
} = vi.hoisted(() => ({
	configureWellnessOnboardingMock: vi.fn(),
	pushMock: vi.fn(),
	skipWellnessSetupMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: toastSuccessMock,
		error: toastErrorMock,
	},
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));

vi.mock("./actions", () => ({
	configureWellnessOnboarding: configureWellnessOnboardingMock,
	skipWellnessSetup: skipWellnessSetupMock,
}));

import WellnessPage from "./page";

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe("WellnessPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("preserves enabled reminder values and submits them while loading", async () => {
		const request = deferred<{ success: true }>();
		configureWellnessOnboardingMock.mockReturnValue(request.promise);

		render(<WellnessPage />);

		const reminderSwitch = screen.getByRole("switch");
		expect(reminderSwitch.getAttribute("aria-checked")).toBe("true");
		expect(
			screen.getByText("Every 45 minutes - recommended for most people"),
		).toBeTruthy();
		expect(screen.getByText("8 glasses")).toBeTruthy();

		fireEvent.click(reminderSwitch);
		expect(screen.queryByText("Reminder Frequency")).toBeNull();
		fireEvent.click(reminderSwitch);
		expect(
			screen.getByText("Every 45 minutes - recommended for most people"),
		).toBeTruthy();

		const continueButton = screen.getByRole("button", { name: "Continue" });
		fireEvent.click(continueButton);

		await waitFor(() => {
			expect(configureWellnessOnboardingMock).toHaveBeenCalledWith({
				enableWaterReminder: true,
				waterReminderPreset: "moderate",
				waterReminderIntervalMinutes: 45,
				waterReminderDailyGoal: 8,
			});
			expect(continueButton).toHaveProperty("disabled", true);
			expect(reminderSwitch).toHaveProperty("disabled", true);
		});

		request.resolve({ success: true });
		await waitFor(() =>
			expect(pushMock).toHaveBeenCalledWith("/onboarding/notifications"),
		);
		expect(pushMock).toHaveBeenCalledWith("/onboarding/notifications");
		expect(pushMock).toHaveBeenCalledOnce();
		expect(continueButton).toHaveProperty("disabled", true);
	});

	it("keeps skip disabled after successful skip navigation", async () => {
		skipWellnessSetupMock.mockResolvedValue({ success: true });
		render(<WellnessPage />);

		const skipButton = screen.getByRole("button", { name: "Skip for now" });
		fireEvent.click(skipButton);

		await waitFor(() =>
			expect(pushMock).toHaveBeenCalledWith("/onboarding/notifications"),
		);
		expect(pushMock).toHaveBeenCalledOnce();
		expect(skipButton).toHaveProperty("disabled", true);
	});

	it("resets submit loading and shows a safe error when configuration rejects", async () => {
		const request = deferred<never>();
		configureWellnessOnboardingMock.mockReturnValue(request.promise);
		render(<WellnessPage />);

		const continueButton = screen.getByRole("button", { name: "Continue" });
		fireEvent.click(continueButton);
		await waitFor(() =>
			expect(continueButton).toHaveProperty("disabled", true),
		);

		await act(async () =>
			request.reject(new Error("private wellness failure")),
		);

		await waitFor(() =>
			expect(continueButton).toHaveProperty("disabled", false),
		);
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Failed to save wellness settings",
		);
		expect(toastSuccessMock).not.toHaveBeenCalled();
		expect(pushMock).not.toHaveBeenCalled();
	});

	it("resets skip loading and shows a safe error when skipping rejects", async () => {
		const request = deferred<never>();
		skipWellnessSetupMock.mockReturnValue(request.promise);
		render(<WellnessPage />);

		const skipButton = screen.getByRole("button", { name: "Skip for now" });
		fireEvent.click(skipButton);
		await waitFor(() => expect(skipButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private skip failure")));

		await waitFor(() => expect(skipButton).toHaveProperty("disabled", false));
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Failed to skip wellness setup",
		);
		expect(toastSuccessMock).not.toHaveBeenCalled();
		expect(pushMock).not.toHaveBeenCalled();
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}
