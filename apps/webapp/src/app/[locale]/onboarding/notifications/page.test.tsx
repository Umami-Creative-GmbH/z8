/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	configureNotificationsOnboarding: vi.fn(),
	push: vi.fn(),
	skipNotificationsSetup: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
	usePushNotifications: vi.fn(),
	requestPermission: vi.fn(),
	useSession: vi.fn(),
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
	usePushNotifications: mocks.usePushNotifications,
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: mocks.push }),
	Link: ({ children, href }: { children: import("react").ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));

vi.mock("./actions", () => ({
	configureNotificationsOnboarding: mocks.configureNotificationsOnboarding,
	skipNotificationsSetup: mocks.skipNotificationsSetup,
}));

vi.mock("@/lib/auth-client", () => ({ useSession: mocks.useSession }));

import NotificationsPage from "./page-client";

function deferred<T>() {
	let reject!: (reason: unknown) => void;
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

describe("NotificationsPage busy state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.useSession.mockReturnValue({
			data: { user: { id: "account-a" }, session: { activeOrganizationId: "org-a" } },
			isPending: false,
		});
		mocks.usePushNotifications.mockReturnValue({
			isLoading: false,
			isSupported: false,
			permission: "default",
			requestPermission: mocks.requestPermission,
		});
	});

	it.each(["default", "denied"])(
		"never stores a %s permission response as push consent",
		async (permission) => {
			mocks.usePushNotifications.mockReturnValue({
				isSupported: true,
				isLoading: false,
				permission: "default",
				requestPermission: mocks.requestPermission,
			});
			mocks.requestPermission.mockResolvedValue(permission);
			mocks.configureNotificationsOnboarding.mockResolvedValue({ success: true });
			render(<NotificationsPage />);
			fireEvent.click(screen.getByRole("button", { name: /^(Enable|Request permission)$/ }));
			await waitFor(() => expect(mocks.requestPermission).toHaveBeenCalledOnce());
			fireEvent.click(
				screen.getByRole("button", { name: /^(Continue|Save preferences and continue)$/ }),
			);
			await waitFor(() =>
				expect(mocks.configureNotificationsOnboarding).toHaveBeenCalledWith(
					expect.objectContaining({ enablePush: false }),
				),
			);
		},
	);
	it("shows granted push permission as a disabled Enabled button", () => {
		mocks.usePushNotifications.mockReturnValue({
			isLoading: false,
			isSupported: true,
			permission: "granted",
			requestPermission: mocks.requestPermission,
		});
		render(<NotificationsPage />);

		const enabled = screen.getByRole("button", { name: "Permission allowed" });
		expect(enabled).toHaveProperty("disabled", true);
		fireEvent.click(enabled);
		expect(mocks.requestPermission).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: "Request permission" })).toBeNull();
	});

	it("keeps the Enable action available before permission is granted", async () => {
		mocks.usePushNotifications.mockReturnValue({
			isLoading: false,
			isSupported: true,
			permission: "default",
			requestPermission: mocks.requestPermission,
		});
		mocks.requestPermission.mockResolvedValue("granted");
		render(<NotificationsPage />);

		const enable = screen.getByRole("button", { name: "Request permission" });
		expect(enable).toHaveProperty("disabled", false);
		fireEvent.click(enable);
		await waitFor(() => expect(mocks.requestPermission).toHaveBeenCalledOnce());
	});

	it("keeps submit disabled after successful configuration navigation", async () => {
		mocks.configureNotificationsOnboarding.mockResolvedValue({ success: true });
		render(<NotificationsPage />);

		const continueButton = screen.getByRole("button", { name: "Save preferences and continue" });
		fireEvent.click(continueButton);

		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/complete"));
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(continueButton).toHaveProperty("disabled", true);
	});

	it("submits the exact notification preference values", async () => {
		mocks.configureNotificationsOnboarding.mockResolvedValue({ success: true });
		render(<NotificationsPage />);

		fireEvent.click(screen.getByRole("switch", { name: "Email Notifications" }));
		fireEvent.click(screen.getByRole("switch", { name: "Approval requests" }));
		fireEvent.click(screen.getByRole("switch", { name: "Team changes" }));
		fireEvent.click(screen.getByRole("button", { name: "Save preferences and continue" }));

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

		await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/onboarding/complete"));
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(skipButton).toHaveProperty("disabled", true);
	});

	it("resets submit loading and shows a safe error when configuration rejects", async () => {
		const request = deferred<never>();
		mocks.configureNotificationsOnboarding.mockReturnValue(request.promise);
		render(<NotificationsPage />);

		const continueButton = screen.getByRole("button", { name: "Save preferences and continue" });
		fireEvent.click(continueButton);
		await waitFor(() => expect(continueButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private configuration failure")));

		await waitFor(() => expect(continueButton).toHaveProperty("disabled", false));
		expect(screen.getByRole("alert").textContent).toContain(
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
		expect(screen.getByRole("alert").textContent).toContain("Failed to skip notification setup");
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});
});

describe("notification arrival ownership", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.useSession.mockReturnValue({
			data: { user: { id: "a" }, session: { activeOrganizationId: "org-a" } },
			isPending: false,
		});
		mocks.usePushNotifications.mockReturnValue({
			isSupported: true,
			isLoading: false,
			permission: "default",
			requestPermission: mocks.requestPermission,
		});
	});
	const request = () => fireEvent.click(screen.getByRole("button", { name: "Request permission" }));
	const save = () =>
		fireEvent.click(screen.getByRole("button", { name: "Save preferences and continue" }));
	const scope = (organizationId: string | null, userId = "a") =>
		mocks.useSession.mockReturnValue({
			data: { user: { id: userId }, session: { activeOrganizationId: organizationId } },
			isPending: false,
		});
	it("permits a fresh save after A to B to A without old completions unlocking it", async () => {
		const old = deferred<{ success: true }>(),
			current = deferred<{ success: false; error: string }>();
		mocks.configureNotificationsOnboarding
			.mockReturnValueOnce(old.promise)
			.mockReturnValueOnce(current.promise);
		const view = render(<NotificationsPage />);
		fireEvent.click(screen.getByRole("switch", { name: "Email Notifications" }));
		save();
		await waitFor(() => expect(mocks.configureNotificationsOnboarding).toHaveBeenCalledTimes(1));
		scope("org-b");
		view.rerender(<NotificationsPage />);
		scope("org-a");
		view.rerender(<NotificationsPage />);
		expect(
			screen.getByRole("switch", { name: "Email Notifications" }).getAttribute("aria-checked"),
		).toBe("false");
		save();
		await waitFor(() => expect(mocks.configureNotificationsOnboarding).toHaveBeenCalledTimes(2));
		await act(async () => old.resolve({ success: true }));
		expect(mocks.push).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Skip for now" })).toHaveProperty("disabled", true);
		await act(async () => current.resolve({ success: false, error: "Current save refused" }));
		expect(screen.getByRole("alert").textContent).toContain("Current save refused");
	});
	it.each(["default", "denied"])(
		"keeps %s permission separate from opt-in and can save email/topics",
		async (permission) => {
			mocks.requestPermission.mockResolvedValue(permission);
			mocks.configureNotificationsOnboarding.mockResolvedValue({ success: true });
			render(<NotificationsPage />);
			request();
			await waitFor(() =>
				expect(
					screen.getByText(
						permission === "default" ? /No permission was granted/ : /Permission was not allowed/,
					),
				).toBeTruthy(),
			);
			expect(
				screen.getByRole("switch", { name: "Push notifications" }).getAttribute("aria-checked"),
			).toBe("false");
			save();
			await waitFor(() =>
				expect(mocks.configureNotificationsOnboarding).toHaveBeenCalledWith({
					enablePush: false,
					enableEmail: true,
					notifyApprovals: true,
					notifyStatusUpdates: true,
					notifyTeamChanges: true,
				}),
			);
		},
	);
	it("opts in only after literal granted and allows independent push preference changes", async () => {
		mocks.requestPermission.mockResolvedValue("granted");
		mocks.configureNotificationsOnboarding.mockResolvedValue({ success: true });
		render(<NotificationsPage />);
		request();
		await waitFor(() =>
			expect(
				screen.getByRole("switch", { name: "Push notifications" }).getAttribute("aria-checked"),
			).toBe("true"),
		);
		expect(screen.getByText(/Permission alone does not enroll/)).toBeTruthy();
		fireEvent.click(screen.getByRole("switch", { name: "Push notifications" }));
		save();
		await waitFor(() =>
			expect(mocks.configureNotificationsOnboarding).toHaveBeenCalledWith(
				expect.objectContaining({ enablePush: false }),
			),
		);
	});
	it("suppresses repeated push and save/skip while permission is held, then recovers rejection", async () => {
		const held = deferred<never>();
		mocks.requestPermission.mockReturnValue(held.promise);
		render(<NotificationsPage />);
		request();
		request();
		save();
		fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
		expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
		expect(mocks.configureNotificationsOnboarding).not.toHaveBeenCalled();
		expect(mocks.skipNotificationsSetup).not.toHaveBeenCalled();
		await act(async () => held.reject(new Error("private browser failure")));
		expect(screen.getByRole("alert").textContent).toContain("Could not request browser permission");
		mocks.requestPermission.mockResolvedValue("default");
		request();
		await waitFor(() => expect(mocks.requestPermission).toHaveBeenCalledTimes(2));
	});
	it.each(["save", "skip"])("suppresses repeated %s and competing actions", async (kind) => {
		const held = deferred<{ success: true }>();
		mocks.configureNotificationsOnboarding.mockReturnValue(held.promise);
		mocks.skipNotificationsSetup.mockReturnValue(held.promise);
		render(<NotificationsPage />);
		const skip = () => fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
		if (kind === "save") {
			save();
			save();
			await waitFor(() => expect(mocks.configureNotificationsOnboarding).toHaveBeenCalledTimes(1));
			skip();
		} else {
			skip();
			skip();
			save();
			expect(mocks.skipNotificationsSetup).toHaveBeenCalledTimes(1);
		}
		request();
		expect(mocks.requestPermission).not.toHaveBeenCalled();
		expect(
			kind === "save" ? mocks.skipNotificationsSetup : mocks.configureNotificationsOnboarding,
		).not.toHaveBeenCalled();
		await act(async () => held.resolve({ success: true }));
		expect(mocks.push).toHaveBeenCalledTimes(1);
	});
	it("discards held push after late org arrival and retains all other choices", async () => {
		const held = deferred<string>();
		scope(null);
		mocks.requestPermission.mockReturnValue(held.promise);
		const view = render(<NotificationsPage />);
		fireEvent.click(screen.getByRole("switch", { name: "Approval requests" }));
		request();
		scope("org-a");
		view.rerender(<NotificationsPage />);
		await act(async () => held.resolve("granted"));
		expect(screen.queryByText(/Browser permission allowed/)).toBeNull();
		expect(
			screen.getByRole("switch", { name: "Push notifications" }).getAttribute("aria-checked"),
		).toBe("false");
		expect(
			screen.getByRole("switch", { name: "Approval requests" }).getAttribute("aria-checked"),
		).toBe("false");
	});
	it("discards old refusal after organization return while a new skip is pending", async () => {
		const held = deferred<{ success: false; error: string }>(),
			skip = deferred<{ success: true }>();
		mocks.configureNotificationsOnboarding.mockReturnValue(held.promise);
		mocks.skipNotificationsSetup.mockReturnValue(skip.promise);
		const view = render(<NotificationsPage />);
		save();
		await waitFor(() => expect(mocks.configureNotificationsOnboarding).toHaveBeenCalledOnce());
		scope("org-b");
		view.rerender(<NotificationsPage />);
		scope("org-a");
		view.rerender(<NotificationsPage />);
		fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
		await act(async () => held.resolve({ success: false, error: "Stale refusal" }));
		expect(screen.queryByText("Stale refusal")).toBeNull();
		expect(screen.getByRole("button", { name: "Skip for now" })).toHaveProperty("disabled", true);
		await act(async () => skip.resolve({ success: true }));
		expect(mocks.push).toHaveBeenCalledTimes(1);
	});
	it("never carries a draft or stale result across accounts A to B to A", async () => {
		const held = deferred<string>();
		mocks.requestPermission.mockReturnValue(held.promise);
		const view = render(<NotificationsPage />);
		fireEvent.click(screen.getByRole("switch", { name: "Team changes" }));
		request();
		scope("org-a", "b");
		view.rerender(<NotificationsPage />);
		scope("org-a", "a");
		view.rerender(<NotificationsPage />);
		await act(async () => held.resolve("granted"));
		expect(screen.getByRole("switch", { name: "Team changes" }).getAttribute("aria-checked")).toBe(
			"true",
		);
		expect(
			screen.getByRole("switch", { name: "Push notifications" }).getAttribute("aria-checked"),
		).toBe("false");
		expect(screen.queryByText(/Browser permission allowed/)).toBeNull();
	});
	it.each(["save", "skip", "push"])(
		"discards %s after Activity disconnect/reconnect and permits a current action",
		async (kind) => {
			const held = deferred<unknown>();
			mocks.configureNotificationsOnboarding.mockReturnValue(held.promise);
			mocks.skipNotificationsSetup.mockReturnValue(held.promise);
			mocks.requestPermission.mockReturnValue(held.promise);
			const view = render(
				<Activity mode="visible">
					<NotificationsPage />
				</Activity>,
			);
			fireEvent.click(screen.getByRole("switch", { name: "Email Notifications" }));
			if (kind === "save") {
				save();
				await waitFor(() => expect(mocks.configureNotificationsOnboarding).toHaveBeenCalledOnce());
			} else if (kind === "push") request();
			else fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
			view.rerender(
				<Activity mode="hidden">
					<NotificationsPage />
				</Activity>,
			);
			view.rerender(
				<Activity mode="visible">
					<NotificationsPage />
				</Activity>,
			);
			await act(async () => held.resolve(kind === "push" ? "granted" : { success: true }));
			expect(mocks.push).not.toHaveBeenCalled();
			expect(screen.queryByText(/Browser permission allowed/)).toBeNull();
			expect(
				screen.getByRole("switch", { name: "Email Notifications" }).getAttribute("aria-checked"),
			).toBe("false");
			mocks.skipNotificationsSetup.mockResolvedValue({ success: true });
			fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
			await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
		},
	);
	it("discards a save on ordinary unmount", async () => {
		const held = deferred<{ success: true }>();
		mocks.configureNotificationsOnboarding.mockReturnValue(held.promise);
		const view = render(<NotificationsPage />);
		save();
		await waitFor(() => expect(mocks.configureNotificationsOnboarding).toHaveBeenCalledOnce());
		view.unmount();
		await act(async () => held.resolve({ success: true }));
		expect(mocks.push).not.toHaveBeenCalled();
	});
	it("waits for the initial account and never treats no session as setup authority", () => {
		mocks.useSession.mockReturnValue({ data: null, isPending: true });
		const view = render(<NotificationsPage />);
		expect(screen.queryByRole("switch")).toBeNull();
		expect(screen.getByRole("status")).toBeTruthy();
		mocks.useSession.mockReturnValue({ data: null, isPending: false });
		view.rerender(<NotificationsPage />);
		expect(screen.getByRole("alert").textContent).toContain("session is unavailable");
		expect(screen.queryByRole("switch")).toBeNull();
		scope(null);
		view.rerender(<NotificationsPage />);
		expect(screen.getAllByRole("switch")).toHaveLength(5);
	});
	it("keeps availability loading and unsupported states separate from preferences", () => {
		mocks.usePushNotifications.mockReturnValue({
			isSupported: false,
			isLoading: true,
			permission: "unsupported",
		});
		const view = render(<NotificationsPage />);
		expect(screen.getByText("Checking push availability…")).toBeTruthy();
		expect(screen.getAllByRole("switch")).toHaveLength(5);
		mocks.usePushNotifications.mockReturnValue({
			isSupported: false,
			isLoading: false,
			permission: "unsupported",
		});
		view.rerender(<NotificationsPage />);
		expect(screen.getByText("Push notifications are not supported in this browser")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Request permission" })).toBeNull();
	});
});
