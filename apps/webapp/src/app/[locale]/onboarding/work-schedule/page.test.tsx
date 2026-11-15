/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkIsAdmin: vi.fn(),
	push: vi.fn(),
	replace: vi.fn(),
	setWorkScheduleOnboarding: vi.fn(),
	skipWorkScheduleSetup: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
	session: {
		data: {
			user: { id: "account-a" },
			session: { id: "session-a", activeOrganizationId: "org-a" },
		},
		isPending: false,
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

vi.mock("@/lib/auth-client", () => ({ useSession: () => mocks.session }));

vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));

vi.mock("./actions", () => ({
	checkIsAdmin: mocks.checkIsAdmin,
	setWorkScheduleOnboarding: mocks.setWorkScheduleOnboarding,
	skipWorkScheduleSetup: mocks.skipWorkScheduleSetup,
}));

import WorkSchedulePage from "./page-client";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

describe("WorkSchedulePage load effect", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkIsAdmin.mockReset();
		mocks.setWorkScheduleOnboarding.mockReset();
		mocks.skipWorkScheduleSetup.mockReset();
		mocks.session = {
			data: {
				user: { id: "account-a" },
				session: { id: "session-a", activeOrganizationId: "org-a" },
			},
			isPending: false,
		};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("captures a fresh UTC effective date for each mounted form", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.setWorkScheduleOnboarding.mockResolvedValue({
			success: true,
			data: { nextStep: "/onboarding/vacation-policy" },
		});

		vi.setSystemTime("2026-01-02T03:04:05.000Z");
		const first = render(<WorkSchedulePage />);
		await act(async () => undefined);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await act(async () => undefined);
		expect(
			mocks.setWorkScheduleOnboarding.mock.calls[0]?.[0].effectiveFrom.toISOString(),
		).toBe("2026-01-02T03:04:05.000Z");

		first.unmount();
		mocks.setWorkScheduleOnboarding.mockClear();
		vi.setSystemTime("2026-07-30T12:13:14.000Z");
		render(<WorkSchedulePage />);
		await act(async () => undefined);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await act(async () => undefined);
		expect(
			mocks.setWorkScheduleOnboarding.mock.calls[0]?.[0].effectiveFrom.toISOString(),
		).toBe("2026-07-30T12:13:14.000Z");
	});

	it("associates schedule fields with their visible labels", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		render(<WorkSchedulePage />);

		expect(await screen.findByLabelText("Hours per Week")).toBeTruthy();
		expect(screen.getByLabelText("Work Classification")).toBeTruthy();
	});

	it("keeps submit disabled after successful schedule navigation", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.setWorkScheduleOnboarding.mockResolvedValue({
			success: true,
			data: { nextStep: "/onboarding/vacation-policy" },
		});
		render(<WorkSchedulePage />);

		const continueButton = await screen.findByRole("button", {
			name: "Continue",
		});
		fireEvent.click(continueButton);

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/vacation-policy"),
		);
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(continueButton).toHaveProperty("disabled", true);
	});

	it("keeps skip disabled after successful skip navigation", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipWorkScheduleSetup.mockResolvedValue({
			success: true,
			data: { nextStep: "/onboarding/vacation-policy" },
		});
		render(<WorkSchedulePage />);

		const skipButton = await screen.findByRole("button", {
			name: "Skip for now",
		});
		fireEvent.click(skipButton);

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/vacation-policy"),
		);
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(skipButton).toHaveProperty("disabled", true);
	});

	it("resets submit loading and shows a safe error when setting the schedule rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.setWorkScheduleOnboarding.mockReturnValue(request.promise);
		render(<WorkSchedulePage />);

		const continueButton = await screen.findByRole("button", {
			name: "Continue",
		});
		fireEvent.click(continueButton);
		await waitFor(() =>
			expect(continueButton).toHaveProperty("disabled", true),
		);

		await act(async () =>
			request.reject(new Error("private schedule failure")),
		);

		await waitFor(() =>
			expect(continueButton).toHaveProperty("disabled", false),
		);
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Failed to set work schedule",
		);
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("resets skip loading and shows a safe error when skipping rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipWorkScheduleSetup.mockReturnValue(request.promise);
		render(<WorkSchedulePage />);

		const skipButton = await screen.findByRole("button", {
			name: "Skip for now",
		});
		fireEvent.click(skipButton);
		await waitFor(() => expect(skipButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private skip failure")));

		await waitFor(() => expect(skipButton).toHaveProperty("disabled", false));
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Failed to skip work schedule setup",
		);
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("does not start the skip mutation after an unmounted access request resolves", async () => {
		const request = deferred<{ success: true; data: false }>();
		mocks.checkIsAdmin.mockReturnValue(request.promise);
		const { unmount } = render(<WorkSchedulePage />);
		await waitFor(() => expect(mocks.checkIsAdmin).toHaveBeenCalledOnce());

		unmount();
		await act(async () => {
			request.resolve({ success: true, data: false });
			await request.promise;
		});

		expect(mocks.skipWorkScheduleSetup).not.toHaveBeenCalled();
		expect(mocks.replace).not.toHaveBeenCalled();
	});

	it("ignores a skip result that resolves after unmount", async () => {
		const request = deferred<{ success: true; data: { nextStep: string } }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: false });
		mocks.skipWorkScheduleSetup.mockReturnValue(request.promise);
		const { unmount } = render(<WorkSchedulePage />);
		await waitFor(() =>
			expect(mocks.skipWorkScheduleSetup).toHaveBeenCalledOnce(),
		);

		unmount();
		await act(async () => {
			request.resolve({
				success: true,
				data: { nextStep: "/onboarding/vacation-policy" },
			});
			await request.promise;
		});

		expect(mocks.replace).not.toHaveBeenCalled();
	});

	it("uses the safe fallback route when the access check rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockReturnValue(request.promise);
		render(<WorkSchedulePage />);

		await act(async () => {
			request.reject(new Error("private access failure"));
		});

		await waitFor(() =>
			expect(mocks.replace).toHaveBeenCalledWith("/onboarding/wellness"),
		);
	});

	it("keeps a refused automatic skip visible and retries the existing owner", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: false });
		mocks.skipWorkScheduleSetup.mockResolvedValueOnce({
			success: false,
			error: "Skip refused",
		});
		render(<WorkSchedulePage />);
		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			"Skip refused",
		);
		expect(mocks.replace).not.toHaveBeenCalled();
		mocks.skipWorkScheduleSetup.mockResolvedValueOnce({
			success: true,
			data: { nextStep: "/onboarding/wellness" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() =>
			expect(mocks.replace).toHaveBeenCalledWith("/onboarding/wellness"),
		);
	});

	it("does not announce or navigate a save that finishes after unmount", async () => {
		const request = deferred<{ success: true; data: { nextStep: string } }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.setWorkScheduleOnboarding.mockReturnValue(request.promise);
		const view = render(<WorkSchedulePage />);
		fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
		await waitFor(() =>
			expect(mocks.setWorkScheduleOnboarding).toHaveBeenCalledOnce(),
		);
		view.unmount();
		await act(async () =>
			request.resolve({ success: true, data: { nextStep: "/old-arrival" } }),
		);
		expect(mocks.push).not.toHaveBeenCalled();
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
	});

	it.each(["save", "skip"])(
		"ignores held %s results through Activity hide and reconnect",
		async (kind) => {
			const request = deferred<{ success: true; data: { nextStep: string } }>();
			mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
			const action =
				kind === "save"
					? mocks.setWorkScheduleOnboarding
					: mocks.skipWorkScheduleSetup;
			action.mockReturnValueOnce(request.promise);
			const view = render(
				<Activity mode="visible">
					<WorkSchedulePage />
				</Activity>,
			);
			fireEvent.change(await screen.findByLabelText("Hours per Week"), {
				target: { value: "32.5" },
			});
			fireEvent.click(
				screen.getByRole("button", {
					name: kind === "save" ? "Continue" : "Skip for now",
				}),
			);
			await waitFor(() => expect(action).toHaveBeenCalledOnce());
			view.rerender(
				<Activity mode="hidden">
					<WorkSchedulePage />
				</Activity>,
			);
			view.rerender(
				<Activity mode="visible">
					<WorkSchedulePage />
				</Activity>,
			);
			expect(await screen.findByLabelText("Hours per Week")).toHaveProperty(
				"value",
				"32.5",
			);
			await act(async () =>
				request.resolve({ success: true, data: { nextStep: "/old-arrival" } }),
			);
			expect(mocks.push).not.toHaveBeenCalled();
			expect(mocks.toastSuccess).not.toHaveBeenCalled();
			expect(
				screen.getByRole("button", { name: "Skip for now" }),
			).toHaveProperty("disabled", false);
		},
	);

	it.each(["account", "organization"])(
		"discards an old administrator check across %s A → B → A",
		async (kind) => {
			const old = deferred<{ success: true; data: boolean }>();
			mocks.checkIsAdmin
				.mockReturnValueOnce(old.promise)
				.mockResolvedValue({ success: true, data: true });
			const view = render(<WorkSchedulePage />);
			await waitFor(() => expect(mocks.checkIsAdmin).toHaveBeenCalledOnce());
			const original = structuredClone(mocks.session);
			if (kind === "account") mocks.session.data.user.id = "account-b";
			else mocks.session.data.session.activeOrganizationId = "org-b";
			view.rerender(<WorkSchedulePage />);
			expect(await screen.findByLabelText("Hours per Week")).toBeTruthy();
			mocks.session = original;
			view.rerender(<WorkSchedulePage />);
			expect(await screen.findByLabelText("Hours per Week")).toBeTruthy();
			await act(async () => old.resolve({ success: true, data: false }));
			expect(mocks.skipWorkScheduleSetup).not.toHaveBeenCalled();
			expect(mocks.replace).not.toHaveBeenCalled();
		},
	);

	it.each([
		["save", "organization"],
		["skip", "organization"],
		["save", "account"],
		["skip", "account"],
	])("ignores old %s refusals across %s A → B → A", async (kind, scope) => {
		const old = deferred<{ success: false; error: string }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		const action =
			kind === "save"
				? mocks.setWorkScheduleOnboarding
				: mocks.skipWorkScheduleSetup;
		action.mockReturnValueOnce(old.promise);
		const view = render(<WorkSchedulePage />);
		fireEvent.click(
			await screen.findByRole("button", {
				name: kind === "save" ? "Continue" : "Skip for now",
			}),
		);
		await waitFor(() => expect(action).toHaveBeenCalledOnce());
		if (scope === "organization")
			mocks.session.data.session.activeOrganizationId = "org-b";
		else mocks.session.data.user.id = "account-b";
		view.rerender(<WorkSchedulePage />);
		expect(await screen.findByLabelText("Hours per Week")).toHaveProperty(
			"value",
			"40",
		);
		if (scope === "organization")
			mocks.session.data.session.activeOrganizationId = "org-a";
		else mocks.session.data.user.id = "account-a";
		view.rerender(<WorkSchedulePage />);
		fireEvent.change(await screen.findByLabelText("Hours per Week"), {
			target: { value: "24" },
		});
		await act(async () =>
			old.resolve({ success: false, error: "Old organization refusal" }),
		);
		expect(screen.getByLabelText("Hours per Week")).toHaveProperty(
			"value",
			"24",
		);
		expect(mocks.toastError).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("keeps administrator checking named and excludes editable fields while held", async () => {
		const request = deferred<{ success: true; data: boolean }>();
		mocks.checkIsAdmin.mockReturnValue(request.promise);
		render(<WorkSchedulePage />);
		expect(
			screen.getByRole("status", { name: "Checking work schedule access" }),
		).toBeTruthy();
		expect(screen.queryByLabelText("Hours per Week")).toBeNull();
		await act(async () => request.resolve({ success: true, data: true }));
		expect(await screen.findByLabelText("Hours per Week")).toBeTruthy();
	});

	it("falls back honestly when access is unavailable rather than treating it as non-admin success", async () => {
		mocks.checkIsAdmin.mockResolvedValue({
			success: false,
			error: "Unavailable",
		});
		render(<WorkSchedulePage />);
		await waitFor(() =>
			expect(mocks.replace).toHaveBeenCalledWith("/onboarding/wellness"),
		);
		expect(mocks.skipWorkScheduleSetup).not.toHaveBeenCalled();
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Work schedule access could not be checked. Continuing to the next available step.",
		);
	});

	it("retains a rejected automatic skip for retry without falling through to wellness", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: false });
		mocks.skipWorkScheduleSetup.mockRejectedValue(
			new Error("Private transport error"),
		);
		render(<WorkSchedulePage />);
		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			"Failed to skip work schedule setup",
		);
		expect(mocks.replace).not.toHaveBeenCalled();
	});

	it("retains failed input and its original effective boundary for an explicit retry", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.setWorkScheduleOnboarding
			.mockResolvedValueOnce({ success: false, error: "Save refused" })
			.mockResolvedValueOnce({
				success: true,
				data: { nextStep: "/server-chosen" },
			});
		render(<WorkSchedulePage />);
		fireEvent.change(await screen.findByLabelText("Hours per Week"), {
			target: { value: "32.5" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			"Save refused",
		);
		expect(screen.getByLabelText("Hours per Week")).toHaveProperty(
			"value",
			"32.5",
		);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/server-chosen"),
		);
		expect(mocks.setWorkScheduleOnboarding.mock.calls[1][0]).toEqual(
			mocks.setWorkScheduleOnboarding.mock.calls[0][0],
		);
		expect(mocks.toastSuccess).toHaveBeenCalledWith(
			"Onboarding progress saved.",
		);
	});

	it("does not repeat a held automatic skip when Activity reconnects", async () => {
		const request = deferred<{ success: true; data: { nextStep: string } }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: false });
		mocks.skipWorkScheduleSetup.mockReturnValueOnce(request.promise);
		const view = render(
			<Activity mode="visible">
				<WorkSchedulePage />
			</Activity>,
		);
		await waitFor(() =>
			expect(mocks.skipWorkScheduleSetup).toHaveBeenCalledOnce(),
		);
		view.rerender(
			<Activity mode="hidden">
				<WorkSchedulePage />
			</Activity>,
		);
		view.rerender(
			<Activity mode="visible">
				<WorkSchedulePage />
			</Activity>,
		);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(mocks.skipWorkScheduleSetup).toHaveBeenCalledOnce();
		await act(async () =>
			request.resolve({ success: true, data: { nextStep: "/old-skip" } }),
		);
		expect(mocks.replace).not.toHaveBeenCalled();
		mocks.skipWorkScheduleSetup.mockResolvedValueOnce({
			success: true,
			data: { nextStep: "/fresh-skip" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() =>
			expect(mocks.replace).toHaveBeenCalledWith("/fresh-skip"),
		);
	});

	it("does not start a queued submit from before an Activity reconnection", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.setWorkScheduleOnboarding.mockResolvedValue({
			success: true,
			data: { nextStep: "/stale-submit" },
		});
		const view = render(
			<Activity mode="visible">
				<WorkSchedulePage />
			</Activity>,
		);
		const button = await screen.findByRole("button", { name: "Continue" });
		fireEvent.click(button);
		view.rerender(
			<Activity mode="hidden">
				<WorkSchedulePage />
			</Activity>,
		);
		view.rerender(
			<Activity mode="visible">
				<WorkSchedulePage />
			</Activity>,
		);
		await act(async () => undefined);
		expect(mocks.setWorkScheduleOnboarding).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("shares the pending lock across duplicate skip clicks and save", async () => {
		const request = deferred<{ success: true; data: { nextStep: string } }>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipWorkScheduleSetup.mockReturnValue(request.promise);
		render(<WorkSchedulePage />);
		const skip = await screen.findByRole("button", { name: "Skip for now" });
		fireEvent.click(skip);
		fireEvent.click(skip);
		const formElement = screen.getByLabelText("Hours per Week").closest("form");
		if (!formElement) throw new Error("Schedule form missing");
		fireEvent.submit(formElement);
		await act(async () => undefined);
		expect(mocks.skipWorkScheduleSetup).toHaveBeenCalledOnce();
		expect(mocks.setWorkScheduleOnboarding).not.toHaveBeenCalled();
		expect(screen.getByLabelText("Hours per Week")).toHaveProperty(
			"disabled",
			true,
		);
		await act(async () =>
			request.resolve({ success: true, data: { nextStep: "/from-skip" } }),
		);
		expect(mocks.push).toHaveBeenCalledOnce();
	});

	it.each([-1, 169])(
		"refuses %s weekly hours before any mutation",
		async (hours) => {
			mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
			render(<WorkSchedulePage />);
			const field = await screen.findByLabelText("Hours per Week");
			fireEvent.change(field, { target: { value: String(hours) } });
			const formElement = field.closest("form");
			if (!formElement) throw new Error("Schedule form missing");
			fireEvent.submit(formElement);
			expect(await screen.findByRole("alert")).toBeTruthy();
			expect(field.getAttribute("aria-invalid")).toBe("true");
			expect(mocks.setWorkScheduleOnboarding).not.toHaveBeenCalled();
		},
	);

	it("keeps one live skip mutation during StrictMode replay", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: false });
		mocks.skipWorkScheduleSetup.mockResolvedValue({
			success: true,
			data: { nextStep: "/onboarding/vacation-policy" },
		});

		render(
			<StrictMode>
				<WorkSchedulePage />
			</StrictMode>,
		);

		await waitFor(() =>
			expect(mocks.replace).toHaveBeenCalledWith("/onboarding/vacation-policy"),
		);
		expect(mocks.checkIsAdmin).toHaveBeenCalledTimes(2);
		expect(mocks.skipWorkScheduleSetup).toHaveBeenCalledOnce();
		expect(mocks.replace).toHaveBeenCalledOnce();
		expect(screen.getByText("Loading...")).toBeTruthy();
	});
});
