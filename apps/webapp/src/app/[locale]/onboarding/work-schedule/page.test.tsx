/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkIsAdmin: vi.fn(),
	push: vi.fn(),
	replace: vi.fn(),
	setWorkScheduleOnboarding: vi.fn(),
	skipWorkScheduleSetup: vi.fn(),
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

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

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
