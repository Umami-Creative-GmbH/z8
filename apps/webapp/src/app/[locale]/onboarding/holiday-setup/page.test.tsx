/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkIsAdmin: vi.fn(),
	createHolidayPresetOnboarding: vi.fn(),
	push: vi.fn(),
	skipHolidaySetup: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({
		data: [{ code: "DE", name: "Germany" }],
		isLoading: false,
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
	createHolidayPresetOnboarding: mocks.createHolidayPresetOnboarding,
	skipHolidaySetup: mocks.skipHolidaySetup,
}));

import HolidaySetupPage from "./page-client";

beforeAll(() => {
	HTMLElement.prototype.scrollIntoView = vi.fn();
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
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

describe("HolidaySetupPage load effect", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkIsAdmin.mockReset();
		mocks.createHolidayPresetOnboarding.mockReset();
		mocks.skipHolidaySetup.mockReset();
	});

	it("keeps submit disabled after successful creation navigation", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createHolidayPresetOnboarding.mockResolvedValue({ success: true });
		render(<HolidaySetupPage />);

		fireEvent.click(await screen.findByRole("combobox"));
		fireEvent.click(await screen.findByText("Germany"));
		const continueButton = screen.getByRole("button", { name: "Continue" });
		fireEvent.click(continueButton);

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/work-templates"),
		);
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(continueButton).toHaveProperty("disabled", true);
	});

	it("submits the exact selected country and preset values", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createHolidayPresetOnboarding.mockResolvedValue({ success: true });
		render(<HolidaySetupPage />);

		fireEvent.click(await screen.findByLabelText("Country"));
		fireEvent.click(await screen.findByText("Germany"));
		fireEvent.change(screen.getByLabelText("Preset Name"), {
			target: { value: "Company Holidays" },
		});
		fireEvent.click(
			screen.getByRole("switch", { name: "Set as organization default" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		await waitFor(() =>
			expect(mocks.createHolidayPresetOnboarding).toHaveBeenCalledWith({
				countryCode: "DE",
				stateCode: "",
				presetName: "Company Holidays",
				setAsDefault: false,
			}),
		);
	});

	it("keeps skip disabled after successful skip navigation", async () => {
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipHolidaySetup.mockResolvedValue({ success: true });
		render(<HolidaySetupPage />);

		const skipButton = await screen.findByRole("button", {
			name: "Skip for now",
		});
		fireEvent.click(skipButton);

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/onboarding/work-templates"),
		);
		expect(mocks.push).toHaveBeenCalledOnce();
		expect(skipButton).toHaveProperty("disabled", true);
	});

	it("resets submit loading and shows a safe error when creation rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.createHolidayPresetOnboarding.mockReturnValue(request.promise);
		render(<HolidaySetupPage />);

		fireEvent.click(await screen.findByRole("combobox"));
		fireEvent.click(await screen.findByText("Germany"));
		const continueButton = screen.getByRole("button", { name: "Continue" });
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
			"Failed to create holiday preset",
		);
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("resets skip loading and shows a safe error when skipping rejects", async () => {
		const request = deferred<never>();
		mocks.checkIsAdmin.mockResolvedValue({ success: true, data: true });
		mocks.skipHolidaySetup.mockReturnValue(request.promise);
		render(<HolidaySetupPage />);

		const skipButton = await screen.findByRole("button", {
			name: "Skip for now",
		});
		fireEvent.click(skipButton);
		await waitFor(() => expect(skipButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private skip failure")));

		await waitFor(() => expect(skipButton).toHaveProperty("disabled", false));
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Failed to skip holiday setup",
		);
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("ignores an admin result that resolves after unmount", async () => {
		const request = deferred<{ success: true; data: false }>();
		mocks.checkIsAdmin.mockReturnValue(request.promise);
		const { unmount } = render(<HolidaySetupPage />);
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
		render(<HolidaySetupPage />);

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
				<HolidaySetupPage />
			</StrictMode>,
		);

		expect(await screen.findByText("Set up holidays")).toBeTruthy();
		expect(mocks.checkIsAdmin).toHaveBeenCalledTimes(2);
		expect(mocks.push).not.toHaveBeenCalled();
	});
});
