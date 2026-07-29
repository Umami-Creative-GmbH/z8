/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkIsAdminMock, createWorkTemplateOnboardingMock, pushMock } =
	vi.hoisted(() => ({
		checkIsAdminMock: vi.fn(),
		createWorkTemplateOnboardingMock: vi.fn(),
		pushMock: vi.fn(),
	}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, values?: Record<string, unknown>) => {
			if (!fallback || !values) return fallback ?? _key;
			return Object.entries(values).reduce(
				(result, [key, value]) => result.replace(`{${key}}`, String(value)),
				fallback,
			);
		},
	}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));
vi.mock("./actions", () => ({
	checkIsAdmin: checkIsAdminMock,
	createWorkTemplateOnboarding: createWorkTemplateOnboardingMock,
	skipWorkTemplateSetup: vi.fn(),
}));

import WorkTemplatesPage from "./page";

describe("WorkTemplatesPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("preserves edited state and submits selected weekdays while loading", async () => {
		checkIsAdminMock.mockResolvedValue({ success: true, data: true });
		let resolveSubmit: (value: { success: true }) => void = () => undefined;
		createWorkTemplateOnboardingMock.mockReturnValue(
			new Promise((resolve) => {
				resolveSubmit = resolve;
			}),
		);

		render(<WorkTemplatesPage />);

		expect(
			await screen.findByText("5 working days, 8.0 hours per day"),
		).toBeTruthy();
		const weekdayCheckboxes = screen.getAllByRole("checkbox");
		expect(
			weekdayCheckboxes.map((checkbox) =>
				checkbox.getAttribute("aria-checked"),
			),
		).toEqual(["true", "true", "true", "true", "true", "false", "false"]);

		fireEvent.change(
			screen.getByPlaceholderText("e.g., Full-Time, Part-Time"),
			{
				target: { value: "Compressed" },
			},
		);
		fireEvent.change(screen.getByPlaceholderText("40"), {
			target: { value: "50" },
		});
		fireEvent.click(weekdayCheckboxes[0]);
		fireEvent.click(weekdayCheckboxes[5]);
		expect(screen.getByText("5 working days, 10.0 hours per day")).toBeTruthy();

		const continueButton = screen.getByRole("button", { name: "Continue" });
		fireEvent.click(continueButton);

		await waitFor(() => {
			expect(createWorkTemplateOnboardingMock).toHaveBeenCalledWith({
				name: "Compressed",
				hoursPerWeek: 50,
				workingDays: ["tuesday", "wednesday", "thursday", "friday", "saturday"],
				setAsDefault: true,
			});
			expect(continueButton.hasAttribute("disabled")).toBe(true);
			expect(
				(screen.getByPlaceholderText("40") as HTMLInputElement).disabled,
			).toBe(true);
		});

		resolveSubmit({ success: true });
		await waitFor(() => {
			expect(pushMock).toHaveBeenCalledWith("/onboarding/notifications");
		});
	});

	it("keeps invalid template state on screen and blocks submission", async () => {
		checkIsAdminMock.mockResolvedValue({ success: true, data: true });
		createWorkTemplateOnboardingMock.mockResolvedValue({ success: true });

		render(<WorkTemplatesPage />);

		const nameInput = await screen.findByPlaceholderText(
			"e.g., Full-Time, Part-Time",
		);
		fireEvent.change(nameInput, { target: { value: "" } });
		fireEvent.blur(nameInput);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		expect(await screen.findByText("Template name is required")).toBeTruthy();
		expect((nameInput as HTMLInputElement).value).toBe("");
		expect(createWorkTemplateOnboardingMock).not.toHaveBeenCalled();
		expect(pushMock).not.toHaveBeenCalledWith("/onboarding/notifications");
	});
});
