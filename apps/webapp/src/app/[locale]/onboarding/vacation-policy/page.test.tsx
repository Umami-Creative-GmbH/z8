/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkIsAdmin: vi.fn(),
	createVacationPolicyOnboarding: vi.fn(),
	push: vi.fn(),
	skipVacationPolicySetup: vi.fn(),
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
	useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));

vi.mock("./actions", () => ({
	checkIsAdmin: mocks.checkIsAdmin,
	createVacationPolicyOnboarding: mocks.createVacationPolicyOnboarding,
	skipVacationPolicySetup: mocks.skipVacationPolicySetup,
}));

import VacationPolicyPage from "./page-client";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

describe("VacationPolicyPage load effect", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkIsAdmin.mockReset();
		mocks.createVacationPolicyOnboarding.mockReset();
		mocks.skipVacationPolicySetup.mockReset();
	});

	it("keeps submit disabled after successful creation navigation", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createVacationPolicyOnboarding.mockResolvedValue({ success: true });
		render(<VacationPolicyPage />);

		const continueButton = await screen.findByRole("button", {
			name: "Continue",
		});
		fireEvent.click(continueButton);

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/holiday-setup"),
		);
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(continueButton).toHaveProperty("disabled", true);
	});

	it("keeps skip disabled after successful skip navigation", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipVacationPolicySetup.mockResolvedValue({ success: true });
		render(<VacationPolicyPage />);

		const skipButton = await screen.findByRole("button", {
			name: "Skip for now",
		});
		fireEvent.click(skipButton);

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/holiday-setup"),
		);
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(skipButton).toHaveProperty("disabled", true);
	});

	it("resets submit loading and shows a safe error when creation rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createVacationPolicyOnboarding.mockReturnValue(request.promise);
		render(<VacationPolicyPage />);

		const continueButton = await screen.findByRole("button", {
			name: "Continue",
		});
		fireEvent.click(continueButton);
		await waitFor(() =>
			expect(continueButton).toHaveProperty("disabled", true),
		);

		await act(async () =>
			request.reject(new Error("private creation failure")),
		);

		await waitFor(() =>
			expect(continueButton).toHaveProperty("disabled", false),
		);
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Failed to create vacation policy",
		);
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("resets skip loading and shows a safe error when skipping rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipVacationPolicySetup.mockReturnValue(request.promise);
		render(<VacationPolicyPage />);

		const skipButton = await screen.findByRole("button", {
			name: "Skip for now",
		});
		fireEvent.click(skipButton);
		await waitFor(() => expect(skipButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private skip failure")));

		await waitFor(() => expect(skipButton).toHaveProperty("disabled", false));
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Failed to skip vacation policy setup",
		);
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("ignores an admin result that resolves after unmount", async () => {
		const request = deferred<{ success: true; data: false }>();
		mocks.checkIsAdmin.mockReturnValue(request.promise);
		const { unmount } = render(<VacationPolicyPage />);
		await waitFor(() => expect(mocks.checkIsAdmin).toHaveBeenCalledOnce());

		unmount();
		await act(async () => {
			request.resolve({ success: true, data: false });
			await request.promise;
		});

		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("uses the safe fallback route when the admin check rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockReturnValue(request.promise);
		render(<VacationPolicyPage />);

		await act(async () => {
			request.reject(new Error("private admin failure"));
		});

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/notifications"),
		);
	});

	it("keeps a live admin request during StrictMode replay", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });

		render(
			<StrictMode>
				<VacationPolicyPage />
			</StrictMode>,
		);

		expect(await screen.findByText("Set up vacation policy")).toBeTruthy();
		expect(mocks.checkIsAdmin).toHaveBeenCalledTimes(2);
		expect(mocks.push).not.toHaveBeenCalled();
	});
});
