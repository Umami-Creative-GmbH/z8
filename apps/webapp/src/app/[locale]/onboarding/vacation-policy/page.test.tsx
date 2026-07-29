/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkIsAdminMock, createVacationPolicyOnboardingMock, pushMock } =
	vi.hoisted(() => ({
		checkIsAdminMock: vi.fn(),
		createVacationPolicyOnboardingMock: vi.fn(),
		pushMock: vi.fn(),
	}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));
vi.mock("./actions", () => ({
	checkIsAdmin: checkIsAdminMock,
	createVacationPolicyOnboarding: createVacationPolicyOnboardingMock,
	skipVacationPolicySetup: vi.fn(),
}));

import VacationPolicyPage from "./page";

describe("VacationPolicyPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("preserves carryover state and submits the policy while loading", async () => {
		checkIsAdminMock.mockResolvedValue({ success: true, data: true });
		let resolveSubmit: (value: { success: true }) => void = () => undefined;
		createVacationPolicyOnboardingMock.mockReturnValue(
			new Promise((resolve) => {
				resolveSubmit = resolve;
			}),
		);

		render(<VacationPolicyPage />);

		const carryoverSwitch = await screen.findByRole("switch");
		const carryoverInput = screen.getByPlaceholderText("5");
		expect(carryoverSwitch.getAttribute("aria-checked")).toBe("true");
		expect((carryoverInput as HTMLInputElement).value).toBe("5");

		fireEvent.change(carryoverInput, { target: { value: "7" } });
		fireEvent.click(screen.getByRole("switch"));
		await waitFor(() => {
			expect(screen.queryByPlaceholderText("5")).toBeNull();
		});
		fireEvent.click(screen.getByRole("switch"));
		await waitFor(() => {
			expect((screen.getByPlaceholderText("5") as HTMLInputElement).value).toBe(
				"7",
			);
		});

		const continueButton = await screen.findByRole("button", {
			name: "Continue",
		});
		fireEvent.click(continueButton);

		await waitFor(() => {
			expect(createVacationPolicyOnboardingMock).toHaveBeenCalledWith({
				name: "Standard",
				defaultAnnualDays: 25,
				accrualType: "annual",
				allowCarryover: true,
				maxCarryoverDays: 7,
			});
			expect(continueButton.hasAttribute("disabled")).toBe(true);
			expect(carryoverSwitch.hasAttribute("disabled")).toBe(true);
		});

		resolveSubmit({ success: true });
		await waitFor(() => {
			expect(pushMock).toHaveBeenCalledWith("/onboarding/holiday-setup");
		});
	});

	it("keeps invalid policy state on screen and blocks submission", async () => {
		checkIsAdminMock.mockResolvedValue({ success: true, data: true });
		createVacationPolicyOnboardingMock.mockResolvedValue({ success: true });

		render(<VacationPolicyPage />);

		const nameInput = await screen.findByPlaceholderText(
			"e.g., Standard, Senior",
		);
		fireEvent.change(nameInput, { target: { value: "" } });
		fireEvent.blur(nameInput);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		expect(await screen.findByText("Policy name is required")).toBeTruthy();
		expect((nameInput as HTMLInputElement).value).toBe("");
		expect(createVacationPolicyOnboardingMock).not.toHaveBeenCalled();
		expect(pushMock).not.toHaveBeenCalledWith("/onboarding/holiday-setup");
	});

	it("ignores an admin check that resolves after unmount", async () => {
		let resolveAdminCheck: (
			value: { success: true; data: false },
		) => void = () => undefined;
		checkIsAdminMock.mockReturnValue(
			new Promise((resolve) => {
				resolveAdminCheck = resolve;
			}),
		);

		const { unmount } = render(<VacationPolicyPage />);
		unmount();
		resolveAdminCheck({ success: true, data: false });

		await Promise.resolve();
		expect(pushMock).not.toHaveBeenCalled();
	});
});
