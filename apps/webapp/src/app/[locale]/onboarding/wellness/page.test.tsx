/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity } from "react";
import { flushSync } from "react-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
	configureWellnessOnboardingMock,
	pushMock,
	skipWellnessSetupMock,
	toastErrorMock,
	toastSuccessMock,
	sessionMock,
} = vi.hoisted(() => ({
	configureWellnessOnboardingMock: vi.fn(),
	pushMock: vi.fn(),
	skipWellnessSetupMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	sessionMock: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({ useSession: sessionMock }));

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
		vi.resetAllMocks();
		sessionMock.mockReturnValue({
			data: {
				user: { id: "account-a" },
				session: { activeOrganizationId: "org-a" },
			},
			isPending: false,
		});
	});

	it("discards a Save queued before Activity returns and retains the goal for a fresh Continue", async () => {
		configureWellnessOnboardingMock.mockResolvedValue({ success: true });
		const content = (mode: "visible" | "hidden") => (
			<Activity mode={mode}>
				<WellnessPage />
			</Activity>
		);
		const view = render(content("visible"));
		fireEvent.keyDown(screen.getByRole("slider", { name: "Daily Goal" }), { key: "End" });
		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Continue" }));
			flushSync(() => view.rerender(content("hidden")));
			flushSync(() => view.rerender(content("visible")));
		});
		await act(async () => {});
		expect(configureWellnessOnboardingMock).not.toHaveBeenCalled();
		expect(pushMock).not.toHaveBeenCalled();
		expect(screen.getByRole("slider", { name: "Daily Goal" }).getAttribute("aria-valuenow")).toBe(
			"20",
		);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await waitFor(() => expect(configureWellnessOnboardingMock).toHaveBeenCalledOnce());
		expect(configureWellnessOnboardingMock).toHaveBeenCalledWith({
			enableWaterReminder: true,
			waterReminderPreset: "moderate",
			waterReminderIntervalMinutes: 45,
			waterReminderDailyGoal: 20,
		});
		expect(pushMock).toHaveBeenCalledExactlyOnceWith("/onboarding/notifications");
	});

	it.each(
		["save", "skip"].flatMap((action) => [
			{ action, boundary: "organization", outcome: "refusal" },
			{ action, boundary: "organization", outcome: "rejected" },
			{ action, boundary: "account", outcome: "success" },
			{ action, boundary: "account", outcome: "rejected" },
			{ action, boundary: "activity", outcome: "refusal" },
			{ action, boundary: "activity", outcome: "rejected" },
			{ action, boundary: "unmount", outcome: "success" },
			{ action, boundary: "unmount", outcome: "refusal" },
		]),
	)("ignores stale $action $outcome across $boundary", async ({ action, boundary, outcome }) => {
		const request = deferred<{ success: true } | { success: false; error: string }>();
		configureWellnessOnboardingMock.mockReturnValue(request.promise);
		skipWellnessSetupMock.mockReturnValue(request.promise);
		const view = render(
			<Activity mode="visible">
				<WellnessPage />
			</Activity>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: action === "save" ? "Continue" : "Skip for now" }),
		);
		await waitFor(() =>
			expect(
				action === "save" ? configureWellnessOnboardingMock : skipWellnessSetupMock,
			).toHaveBeenCalledOnce(),
		);
		if (boundary === "unmount") view.unmount();
		else if (boundary === "activity") {
			view.rerender(
				<Activity mode="hidden">
					<WellnessPage />
				</Activity>,
			);
			view.rerender(
				<Activity mode="visible">
					<WellnessPage />
				</Activity>,
			);
		} else {
			sessionMock.mockReturnValue({
				data: {
					user: { id: boundary === "account" ? "account-b" : "account-a" },
					session: { activeOrganizationId: boundary === "organization" ? "org-b" : "org-a" },
				},
				isPending: false,
			});
			view.rerender(
				<Activity mode="visible">
					<WellnessPage />
				</Activity>,
			);
			sessionMock.mockReturnValue({
				data: { user: { id: "account-a" }, session: { activeOrganizationId: "org-a" } },
				isPending: false,
			});
			view.rerender(
				<Activity mode="visible">
					<WellnessPage />
				</Activity>,
			);
		}
		await act(async () => {
			if (outcome === "rejected") request.reject(new Error("private old transport"));
			else if (outcome === "refusal") request.resolve({ success: false, error: "Old refusal" });
			else request.resolve({ success: true });
		});
		expect(pushMock).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();
		expect(toastErrorMock).not.toHaveBeenCalled();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("prevents native save activation while skip is held", async () => {
		const request = deferred<{ success: true }>();
		skipWellnessSetupMock.mockReturnValue(request.promise);
		render(<WellnessPage />);
		fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
		await waitFor(() => expect(skipWellnessSetupMock).toHaveBeenCalledOnce());
		const form = screen.getByRole("button", { name: "Continue" }).closest("form");
		if (!form) throw new Error("Expected a real wellness form");
		fireEvent.submit(form);
		await act(async () => {});
		expect(configureWellnessOnboardingMock).not.toHaveBeenCalled();
		await act(async () => request.resolve({ success: true }));
	});

	it("holds preference activation until the current account is resolved", () => {
		sessionMock.mockReturnValue({ data: null, isPending: true });
		render(<WellnessPage />);
		expect(screen.getByRole("heading", { level: 1, name: "Stay Hydrated" })).toBeTruthy();
		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.queryByRole("switch")).toBeNull();
	});

	it("keeps personal preferences available without an active organization", async () => {
		sessionMock.mockReturnValue({
			data: { user: { id: "account-a" }, session: { activeOrganizationId: null } },
			isPending: false,
		});
		configureWellnessOnboardingMock.mockResolvedValue({ success: true });
		render(<WellnessPage />);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/onboarding/notifications"));
	});

	it.each(["save", "skip"])(
		"ignores held %s success after an organization round trip and retains the personal draft",
		async (action) => {
			const request = deferred<{ success: true }>();
			configureWellnessOnboardingMock.mockReturnValue(request.promise);
			skipWellnessSetupMock.mockReturnValue(request.promise);
			const view = render(<WellnessPage />);
			fireEvent.keyDown(screen.getByRole("slider", { name: "Daily Goal" }), {
				key: "ArrowRight",
			});
			fireEvent.click(
				screen.getByRole("button", {
					name: action === "save" ? "Continue" : "Skip for now",
				}),
			);
			await waitFor(() =>
				expect(
					action === "save" ? configureWellnessOnboardingMock : skipWellnessSetupMock,
				).toHaveBeenCalledOnce(),
			);
			sessionMock.mockReturnValue({
				data: {
					user: { id: "account-a" },
					session: { activeOrganizationId: "org-b" },
				},
				isPending: false,
			});
			view.rerender(<WellnessPage />);
			sessionMock.mockReturnValue({
				data: {
					user: { id: "account-a" },
					session: { activeOrganizationId: "org-a" },
				},
				isPending: false,
			});
			view.rerender(<WellnessPage />);
			await act(async () => request.resolve({ success: true }));
			expect(pushMock).not.toHaveBeenCalled();
			expect(toastSuccessMock).not.toHaveBeenCalled();
			expect(screen.getByRole("slider", { name: "Daily Goal" }).getAttribute("aria-valuenow")).toBe(
				"9",
			);
			expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", false);
		},
	);

	it("shows save refusal beside the retained draft and allows retry", async () => {
		configureWellnessOnboardingMock
			.mockResolvedValueOnce({ success: false, error: "Please sign in again" })
			.mockResolvedValueOnce({ success: true });
		render(<WellnessPage />);
		fireEvent.keyDown(screen.getByRole("slider", { name: "Daily Goal" }), {
			key: "End",
		});
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Please sign in again");
		expect(screen.getByRole("slider", { name: "Daily Goal" }).getAttribute("aria-valuenow")).toBe(
			"20",
		);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await waitFor(() => expect(pushMock).toHaveBeenCalledOnce());
	});

	it.each(["save", "skip"])(
		"keeps account drafts separate and ignores late %s after an account round trip",
		async (action) => {
			const request = deferred<{ success: false; error: string }>();
			configureWellnessOnboardingMock.mockReturnValue(request.promise);
			skipWellnessSetupMock.mockReturnValue(request.promise);
			const view = render(<WellnessPage />);
			fireEvent.keyDown(screen.getByRole("slider", { name: "Daily Goal" }), {
				key: "End",
			});
			fireEvent.click(
				screen.getByRole("button", {
					name: action === "save" ? "Continue" : "Skip for now",
				}),
			);
			await waitFor(() =>
				expect(
					action === "save" ? configureWellnessOnboardingMock : skipWellnessSetupMock,
				).toHaveBeenCalledOnce(),
			);
			sessionMock.mockReturnValue({
				data: {
					user: { id: "account-b" },
					session: { activeOrganizationId: "org-a" },
				},
				isPending: false,
			});
			view.rerender(<WellnessPage />);
			expect(screen.getByRole("slider", { name: "Daily Goal" }).getAttribute("aria-valuenow")).toBe(
				"8",
			);
			sessionMock.mockReturnValue({
				data: {
					user: { id: "account-a" },
					session: { activeOrganizationId: "org-a" },
				},
				isPending: false,
			});
			view.rerender(<WellnessPage />);
			expect(screen.getByRole("slider", { name: "Daily Goal" }).getAttribute("aria-valuenow")).toBe(
				"20",
			);
			fireEvent.click(screen.getByRole("button", { name: "Continue" }));
			await act(async () => {});
			expect(configureWellnessOnboardingMock).toHaveBeenCalledTimes(action === "save" ? 1 : 0);
			await act(async () => request.resolve({ success: false, error: "Old refusal" }));
			expect(pushMock).not.toHaveBeenCalled();
			expect(toastErrorMock).not.toHaveBeenCalled();
			expect(screen.queryByRole("alert")).toBeNull();
		},
	);

	it.each(["save", "skip"])(
		"ignores %s after Activity deactivation, retains draft, and allows a fresh retry",
		async (action) => {
			const request = deferred<{ success: true }>();
			configureWellnessOnboardingMock
				.mockReturnValueOnce(request.promise)
				.mockResolvedValue({ success: true });
			skipWellnessSetupMock
				.mockReturnValueOnce(request.promise)
				.mockResolvedValue({ success: true });
			const view = render(
				<Activity mode="visible">
					<WellnessPage />
				</Activity>,
			);
			fireEvent.keyDown(screen.getByRole("slider", { name: "Daily Goal" }), {
				key: "Home",
			});
			fireEvent.click(
				screen.getByRole("button", {
					name: action === "save" ? "Continue" : "Skip for now",
				}),
			);
			await waitFor(() =>
				expect(
					action === "save" ? configureWellnessOnboardingMock : skipWellnessSetupMock,
				).toHaveBeenCalledOnce(),
			);
			view.rerender(
				<Activity mode="hidden">
					<WellnessPage />
				</Activity>,
			);
			await act(async () => request.resolve({ success: true }));
			view.rerender(
				<Activity mode="visible">
					<WellnessPage />
				</Activity>,
			);
			expect(pushMock).not.toHaveBeenCalled();
			expect(toastSuccessMock).not.toHaveBeenCalled();
			expect(screen.getByRole("slider", { name: "Daily Goal" }).getAttribute("aria-valuenow")).toBe(
				"1",
			);
			fireEvent.click(
				screen.getByRole("button", {
					name: action === "save" ? "Continue" : "Skip for now",
				}),
			);
			await waitFor(() => expect(pushMock).toHaveBeenCalledOnce());
		},
	);

	it("preserves enabled reminder values and submits them while loading", async () => {
		const request = deferred<{ success: true }>();
		configureWellnessOnboardingMock.mockReturnValue(request.promise);

		render(<WellnessPage />);

		const reminderSwitch = screen.getByRole("switch");
		expect(reminderSwitch.getAttribute("aria-checked")).toBe("true");
		expect(screen.getByText("Every 45 minutes - recommended for most people")).toBeTruthy();
		expect(screen.getByText("8 glasses")).toBeTruthy();

		fireEvent.click(reminderSwitch);
		expect(screen.queryByText("Reminder Frequency")).toBeNull();
		fireEvent.click(reminderSwitch);
		expect(screen.getByText("Every 45 minutes - recommended for most people")).toBeTruthy();

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
		await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/onboarding/notifications"));
		expect(pushMock).toHaveBeenCalledWith("/onboarding/notifications");
		expect(pushMock).toHaveBeenCalledOnce();
		expect(continueButton).toHaveProperty("disabled", true);
	});

	it("preserves preset/custom relationships, slider limits, disabled drafts and the exact save payload", async () => {
		const user = userEvent.setup();
		configureWellnessOnboardingMock.mockResolvedValue({ success: true });
		render(<WellnessPage />);
		async function choose(name: string) {
			await user.click(screen.getByLabelText("Reminder Frequency"));
			await user.click(await screen.findByRole("option", { name }));
		}
		await choose("Custom");
		const interval = () => screen.getByRole("slider", { name: "Custom Interval" });
		expect(interval().getAttribute("aria-valuenow")).toBe("45");
		fireEvent.keyDown(interval(), { key: "Home" });
		expect(interval().getAttribute("aria-valuenow")).toBe("15");
		fireEvent.keyDown(interval(), { key: "ArrowRight" });
		expect(interval().getAttribute("aria-valuenow")).toBe("20");
		fireEvent.keyDown(interval(), { key: "End" });
		expect(interval().getAttribute("aria-valuenow")).toBe("120");
		await choose("Light");
		await choose("Custom");
		expect(interval().getAttribute("aria-valuenow")).toBe("60");
		await choose("Active");
		await choose("Custom");
		expect(interval().getAttribute("aria-valuenow")).toBe("30");
		fireEvent.keyDown(interval(), { key: "ArrowRight" });
		fireEvent.keyDown(screen.getByRole("slider", { name: "Daily Goal" }), { key: "End" });
		await user.click(screen.getByRole("switch"));
		expect(screen.queryByRole("slider")).toBeNull();
		await user.click(screen.getByRole("switch"));
		expect(interval().getAttribute("aria-valuenow")).toBe("35");
		await user.click(screen.getByRole("switch"));
		await user.click(screen.getByRole("button", { name: "Continue" }));
		await waitFor(() =>
			expect(configureWellnessOnboardingMock).toHaveBeenCalledWith({
				enableWaterReminder: false,
				waterReminderPreset: "custom",
				waterReminderIntervalMinutes: 35,
				waterReminderDailyGoal: 20,
			}),
		);
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it.each(["save", "skip"])("ignores held %s after unmount", async (action) => {
		const request = deferred<never>();
		configureWellnessOnboardingMock.mockReturnValue(request.promise);
		skipWellnessSetupMock.mockReturnValue(request.promise);
		const view = render(<WellnessPage />);
		fireEvent.click(
			screen.getByRole("button", { name: action === "save" ? "Continue" : "Skip for now" }),
		);
		await waitFor(() =>
			expect(
				action === "save" ? configureWellnessOnboardingMock : skipWellnessSetupMock,
			).toHaveBeenCalledOnce(),
		);
		view.unmount();
		await act(async () => request.reject(new Error("private transport detail")));
		expect(pushMock).not.toHaveBeenCalled();
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("associates wellness controls with their visible labels", () => {
		render(<WellnessPage />);

		expect(screen.getByRole("switch", { name: "Enable Water Reminders" })).toBeTruthy();
		expect(screen.getByLabelText("Reminder Frequency")).toBeTruthy();
		expect(screen.getByRole("slider", { name: "Daily Goal" })).toBeTruthy();
	});

	it("keeps skip disabled after successful skip navigation", async () => {
		skipWellnessSetupMock.mockResolvedValue({ success: true });
		render(<WellnessPage />);

		const skipButton = screen.getByRole("button", { name: "Skip for now" });
		fireEvent.click(skipButton);

		await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/onboarding/notifications"));
		expect(pushMock).toHaveBeenCalledOnce();
		expect(skipButton).toHaveProperty("disabled", true);
	});

	it("allows returning to the personal step after completed navigation", async () => {
		configureWellnessOnboardingMock.mockResolvedValue({ success: true });
		const view = render(
			<Activity mode="visible">
				<WellnessPage />
			</Activity>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await waitFor(() => expect(pushMock).toHaveBeenCalledOnce());
		view.rerender(
			<Activity mode="hidden">
				<WellnessPage />
			</Activity>,
		);
		view.rerender(
			<Activity mode="visible">
				<WellnessPage />
			</Activity>,
		);
		expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", false);
	});

	it("resets submit loading and shows a safe error when configuration rejects", async () => {
		const request = deferred<never>();
		configureWellnessOnboardingMock.mockReturnValue(request.promise);
		render(<WellnessPage />);

		const continueButton = screen.getByRole("button", { name: "Continue" });
		fireEvent.click(continueButton);
		await waitFor(() => expect(continueButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private wellness failure")));

		await waitFor(() => expect(continueButton).toHaveProperty("disabled", false));
		expect(toastErrorMock).toHaveBeenCalledWith("Failed to save wellness settings");
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
		expect(toastErrorMock).toHaveBeenCalledWith("Failed to skip wellness setup");
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
