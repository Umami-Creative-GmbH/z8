/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateWellnessSettings } from "@/app/[locale]/(app)/settings/wellness/actions";
import { WellnessSettingsForm } from "./wellness-settings-form";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/wellness/actions", () => ({
	updateWellnessSettings: vi.fn(),
}));

describe("WellnessSettingsForm", () => {
	beforeEach(() => vi.clearAllMocks());

	it("names the daily-goal decrement and increment controls", () => {
		render(
			<WellnessSettingsForm
				initialSettings={{
					enabled: true,
					preset: "moderate",
					intervalMinutes: 45,
					dailyGoal: 8,
				}}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Decrease daily goal" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Increase daily goal" }),
		).toBeTruthy();
	});

	it("re-enables save and reports the existing error when updating rejects", async () => {
		const user = userEvent.setup();
		vi.mocked(updateWellnessSettings).mockRejectedValue(
			new Error("Network failed"),
		);
		render(
			<WellnessSettingsForm
				initialSettings={{
					enabled: true,
					preset: "moderate",
					intervalMinutes: 45,
					dailyGoal: 8,
				}}
			/>,
		);

		await user.click(
			screen.getByRole("button", { name: "Increase daily goal" }),
		);
		await user.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Save Changes" }),
			).toHaveProperty("disabled", false),
		);
		expect(toast.error).toHaveBeenCalledWith(
			"Failed to save wellness settings",
		);
		expect(toast.success).not.toHaveBeenCalled();
	});
});
