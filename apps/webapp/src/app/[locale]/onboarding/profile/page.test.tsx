/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const {
	pushMock,
	skipProfileSetupMock,
	toastErrorMock,
	toastSuccessMock,
	updateProfileOnboardingMock,
	calendarProps,
} = vi.hoisted(() => ({
	pushMock: vi.fn(),
	skipProfileSetupMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	updateProfileOnboardingMock: vi.fn(),
	calendarProps: [] as Array<{ endMonth?: Date }>,
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

vi.mock("@/components/ui/calendar", () => ({
	Calendar: (props: { endMonth?: Date }) => {
		calendarProps.push(props);
		return <div>calendar</div>;
	},
}));

vi.mock("./actions", () => ({
	skipProfileSetup: skipProfileSetupMock,
	updateProfileOnboarding: updateProfileOnboardingMock,
}));

import ProfilePage from "./page";

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe("ProfilePage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		calendarProps.length = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("captures a fresh UTC calendar limit for each mounted page", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime("2026-01-02T03:04:05.000Z");
		const first = render(<ProfilePage />);
		fireEvent.click(
			screen.getByRole("button", { name: "Birthday (Optional)" }),
		);
		expect(calendarProps.at(-1)?.endMonth?.toISOString()).toBe(
			"2026-01-02T03:04:05.000Z",
		);

		first.unmount();
		vi.setSystemTime("2026-07-30T12:13:14.000Z");
		render(<ProfilePage />);
		fireEvent.click(
			screen.getByRole("button", { name: "Birthday (Optional)" }),
		);
		expect(calendarProps.at(-1)?.endMonth?.toISOString()).toBe(
			"2026-07-30T12:13:14.000Z",
		);
	});

	it("renders the profile preferences and submits the default values", async () => {
		updateProfileOnboardingMock.mockResolvedValue({
			success: true,
			data: { nextStep: "/onboarding/organization" },
		});

		render(<ProfilePage />);

		expect(screen.getByText("First day of the week")).toBeTruthy();
		expect(
			screen.getByText(
				"This controls how calendars and weekly summaries are displayed.",
			),
		).toBeTruthy();
		expect(screen.getByText("Time format")).toBeTruthy();
		expect(
			screen.getByText("This controls how clock times are displayed."),
		).toBeTruthy();
		const helpImproveProduct = screen.getByRole("checkbox", {
			name: "Help us improve this app",
		});
		expect(helpImproveProduct.getAttribute("aria-checked")).toBe("true");

		fireEvent.change(screen.getByLabelText("First Name"), {
			target: { value: "Ada" },
		});
		fireEvent.change(screen.getByLabelText("Last Name"), {
			target: { value: "Lovelace" },
		});
		fireEvent.click(helpImproveProduct);
		const continueButton = screen.getByRole("button", { name: "Continue" });
		fireEvent.click(continueButton);

		await waitFor(() => {
			expect(updateProfileOnboardingMock).toHaveBeenCalledWith(
				expect.objectContaining({
					firstName: "Ada",
					lastName: "Lovelace",
					weekStartDay: "monday",
					timeFormat: "24h",
					helpImproveProduct: false,
				}),
			);
		});
		expect(pushMock).toHaveBeenCalledWith("/onboarding/organization");
		expect(pushMock).toHaveBeenCalledOnce();
		expect(continueButton).toHaveProperty("disabled", true);
	});

	it("associates profile fields with their visible labels", () => {
		render(<ProfilePage />);

		expect(screen.getByLabelText("First Name")).toBeTruthy();
		expect(screen.getByLabelText("Last Name")).toBeTruthy();
		expect(screen.getByLabelText("Birthday (Optional)")).toBeTruthy();
		expect(screen.getByLabelText("First day of the week")).toBeTruthy();
		expect(screen.getByLabelText("Time format")).toBeTruthy();
		expect(
			screen.getByRole("checkbox", { name: "Help us improve this app" }),
		).toBeTruthy();
	});

	it("keeps skip disabled after successful skip navigation", async () => {
		skipProfileSetupMock.mockResolvedValue({
			success: true,
			data: { nextStep: "/onboarding/organization" },
		});
		render(<ProfilePage />);

		const skipButton = screen.getByRole("button", { name: "Skip for now" });
		fireEvent.click(skipButton);

		await waitFor(() =>
			expect(pushMock).toHaveBeenCalledWith("/onboarding/organization"),
		);
		expect(pushMock).toHaveBeenCalledOnce();
		expect(skipButton).toHaveProperty("disabled", true);
	});

	it("resets submit loading and shows a safe error when updating rejects", async () => {
		const request = deferred<never>();
		updateProfileOnboardingMock.mockReturnValue(request.promise);
		render(<ProfilePage />);
		fireEvent.change(screen.getByPlaceholderText("John"), {
			target: { value: "Ada" },
		});
		fireEvent.change(screen.getByPlaceholderText("Doe"), {
			target: { value: "Lovelace" },
		});

		const continueButton = screen.getByRole("button", { name: "Continue" });
		fireEvent.click(continueButton);
		await waitFor(() =>
			expect(continueButton).toHaveProperty("disabled", true),
		);

		await act(async () => request.reject(new Error("private profile failure")));

		await waitFor(() =>
			expect(continueButton).toHaveProperty("disabled", false),
		);
		expect(toastErrorMock).toHaveBeenCalledWith("Failed to update profile");
		expect(toastSuccessMock).not.toHaveBeenCalled();
		expect(pushMock).not.toHaveBeenCalled();
	});

	it("resets skip loading and shows a safe error when skipping rejects", async () => {
		const request = deferred<never>();
		skipProfileSetupMock.mockReturnValue(request.promise);
		render(<ProfilePage />);

		const skipButton = screen.getByRole("button", { name: "Skip for now" });
		fireEvent.click(skipButton);
		await waitFor(() => expect(skipButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private skip failure")));

		await waitFor(() => expect(skipButton).toHaveProperty("disabled", false));
		expect(toastErrorMock).toHaveBeenCalledWith("Failed to skip profile setup");
		expect(toastSuccessMock).not.toHaveBeenCalled();
		expect(pushMock).not.toHaveBeenCalled();
	});
});

function deferred<T>() {
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((_resolve, rejectPromise) => {
		reject = rejectPromise;
	});
	return { promise, reject };
}
