/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
	pushMock,
	skipProfileSetupMock,
	toastErrorMock,
	toastSuccessMock,
	updateProfileOnboardingMock,
	calendarProps,
	sessionState,
} = vi.hoisted(() => ({
	pushMock: vi.fn(),
	skipProfileSetupMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	updateProfileOnboardingMock: vi.fn(),
	calendarProps: [] as Array<{ endMonth?: Date; onSelect?: (value: Date | undefined) => void }>,
	sessionState: {
		data: { user: { id: "account-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	},
}));

vi.mock("@/lib/auth-client", () => ({ useSession: () => sessionState }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("next-intl", () => ({
	useLocale: () => "en",
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
	Calendar: (props: { endMonth?: Date; onSelect?: (value: Date | undefined) => void }) => {
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
		sessionState.data = { user: { id: "account-a" }, session: { activeOrganizationId: "org-a" } };
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("captures a fresh UTC calendar limit for each mounted page", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime("2026-01-02T03:04:05.000Z");
		const first = render(<ProfilePage />);
		fireEvent.click(screen.getByRole("button", { name: "Birthday (Optional)" }));
		expect(calendarProps.at(-1)?.endMonth?.toISOString()).toBe("2026-01-02T00:00:00.000Z");

		first.unmount();
		vi.setSystemTime("2026-07-30T12:13:14.000Z");
		render(<ProfilePage />);
		fireEvent.click(screen.getByRole("button", { name: "Birthday (Optional)" }));
		expect(calendarProps.at(-1)?.endMonth?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
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
				"This changes calendar and summary display only. Compliance and submission weeks stay unchanged.",
			),
		).toBeTruthy();
		expect(screen.getByText("Time format")).toBeTruthy();
		expect(screen.getByText("This controls how clock times are displayed.")).toBeTruthy();
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
		const continueButton = screen.getByRole("button", { name: "Save and continue" });
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
		expect(screen.getByRole("checkbox", { name: "Help us improve this app" })).toBeTruthy();
	});

	it("focuses and links the required-name error without sending an invalid save", async () => {
		render(<ProfilePage />);
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
		await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("First Name")));
		const input = screen.getByLabelText("First Name");
		expect(input.getAttribute("aria-invalid")).toBe("true");
		const message = screen.getByText("First name is required");
		expect(input.getAttribute("aria-describedby")).toContain(message.id);
		expect(updateProfileOnboardingMock).not.toHaveBeenCalled();
	});

	it("sends the selected civil birthday and permits clearing optional gender", async () => {
		updateProfileOnboardingMock.mockResolvedValue({
			success: true,
			data: { nextStep: "/onboarding/wellness" },
		});
		render(<ProfilePage />);
		fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "Ada" } });
		fireEvent.change(screen.getByLabelText("Last Name"), { target: { value: "Lovelace" } });
		fireEvent.click(screen.getByRole("button", { name: "Female" }));
		fireEvent.click(screen.getByRole("button", { name: "Female" }));
		fireEvent.click(screen.getByRole("button", { name: "Birthday (Optional)" }));
		act(() => calendarProps.at(-1)?.onSelect?.(new Date(2000, 1, 29)));
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
		await waitFor(() =>
			expect(updateProfileOnboardingMock).toHaveBeenCalledWith(
				expect.objectContaining({ birthday: "2000-02-29", gender: undefined }),
			),
		);
	});

	it("locks skip synchronously against repeated activation and save", async () => {
		skipProfileSetupMock.mockReturnValue(new Promise(() => {}));
		render(<ProfilePage />);
		const skip = screen.getByRole("button", { name: "Skip for now" });
		act(() => {
			fireEvent.click(skip);
			fireEvent.click(skip);
			fireEvent.submit(skip.closest("form")!);
		});
		await waitFor(() => expect(skipProfileSetupMock).toHaveBeenCalledOnce());
		expect(updateProfileOnboardingMock).not.toHaveBeenCalled();
	});

	it.each(["save", "skip"])("ignores %s completion after unmount", async (action) => {
		let finish!: (value: unknown) => void;
		const request = new Promise((resolve) => {
			finish = resolve;
		});
		updateProfileOnboardingMock.mockReturnValue(request);
		skipProfileSetupMock.mockReturnValue(request);
		const view = render(<ProfilePage />);
		fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "Ada" } });
		fireEvent.change(screen.getByLabelText("Last Name"), { target: { value: "Lovelace" } });
		fireEvent.click(
			screen.getByRole("button", {
				name: action === "save" ? "Save and continue" : "Skip for now",
			}),
		);
		await waitFor(() =>
			expect(
				action === "save" ? updateProfileOnboardingMock : skipProfileSetupMock,
			).toHaveBeenCalledOnce(),
		);
		view.unmount();
		await act(async () => finish({ success: true, data: { nextStep: "/onboarding/wellness" } }));
		expect(pushMock).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it.each(["account", "organization"])(
		"ignores a held skip across an %s A to B to A round trip",
		async (scope) => {
			let finish!: (value: unknown) => void;
			skipProfileSetupMock.mockReturnValue(
				new Promise((resolve) => {
					finish = resolve;
				}),
			);
			const view = render(<ProfilePage />);
			fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
			await waitFor(() => expect(skipProfileSetupMock).toHaveBeenCalledOnce());
			if (scope === "account") sessionState.data.user.id = "account-b";
			else sessionState.data.session.activeOrganizationId = "org-b";
			view.rerender(<ProfilePage />);
			if (scope === "account") sessionState.data.user.id = "account-a";
			else sessionState.data.session.activeOrganizationId = "org-a";
			view.rerender(<ProfilePage />);
			await act(async () => finish({ success: true, data: { nextStep: "/onboarding/wellness" } }));
			expect(pushMock).not.toHaveBeenCalled();
			expect(toastSuccessMock).not.toHaveBeenCalled();
		},
	);

	it.each(["save", "skip"])(
		"discards held %s responses after Activity hides and resumes the page",
		async (action) => {
			let finish!: (value: unknown) => void;
			const request = new Promise((resolve) => {
				finish = resolve;
			});
			updateProfileOnboardingMock.mockReturnValue(request);
			skipProfileSetupMock.mockReturnValue(request);
			const view = render(
				<Activity mode="visible">
					<ProfilePage />
				</Activity>,
			);
			fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "Ada" } });
			fireEvent.change(screen.getByLabelText("Last Name"), { target: { value: "Lovelace" } });
			fireEvent.click(
				screen.getByRole("button", {
					name: action === "save" ? "Save and continue" : "Skip for now",
				}),
			);
			await waitFor(() =>
				expect(
					action === "save" ? updateProfileOnboardingMock : skipProfileSetupMock,
				).toHaveBeenCalledOnce(),
			);
			view.rerender(
				<Activity mode="hidden">
					<ProfilePage />
				</Activity>,
			);
			await act(async () => finish({ success: true, data: { nextStep: "/onboarding/wellness" } }));
			view.rerender(
				<Activity mode="visible">
					<ProfilePage />
				</Activity>,
			);
			expect(pushMock).not.toHaveBeenCalled();
			expect(toastSuccessMock).not.toHaveBeenCalled();
			expect(screen.getByLabelText("First Name")).toHaveProperty("value", "Ada");
			expect(screen.getByRole("button", { name: "Skip for now" })).toHaveProperty(
				"disabled",
				false,
			);
		},
	);

	it("retains the draft and offers inline recovery after an authoritative refusal", async () => {
		updateProfileOnboardingMock.mockResolvedValue({ success: false, error: "Please retry" });
		render(<ProfilePage />);
		fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "Ada" } });
		fireEvent.change(screen.getByLabelText("Last Name"), { target: { value: "Lovelace" } });
		fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
		await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Please retry"));
		expect(screen.getByLabelText("First Name")).toHaveProperty("value", "Ada");
		updateProfileOnboardingMock.mockResolvedValue({
			success: true,
			data: { nextStep: "/onboarding/wellness" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
		await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/onboarding/wellness"));
	});

	it("exposes the gender choices as a labelled group of toggle buttons", () => {
		render(<ProfilePage />);

		const group = screen.getByRole("group", { name: "Gender (Optional)" });
		const female = within(group).getByRole("button", { name: "Female" });
		expect(female.getAttribute("aria-pressed")).toBe("false");

		fireEvent.click(female);

		expect(female.getAttribute("aria-pressed")).toBe("true");
		expect(within(group).getByRole("button", { name: "Male" }).getAttribute("aria-pressed")).toBe(
			"false",
		);
	});

	it("keeps skip disabled after successful skip navigation", async () => {
		skipProfileSetupMock.mockResolvedValue({
			success: true,
			data: { nextStep: "/onboarding/organization" },
		});
		render(<ProfilePage />);

		const skipButton = screen.getByRole("button", { name: "Skip for now" });
		fireEvent.click(skipButton);

		await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/onboarding/organization"));
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

		const continueButton = screen.getByRole("button", { name: "Save and continue" });
		fireEvent.click(continueButton);
		await waitFor(() => expect(continueButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private profile failure")));

		await waitFor(() => expect(continueButton).toHaveProperty("disabled", false));
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
