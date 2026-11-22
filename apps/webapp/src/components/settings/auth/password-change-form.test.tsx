/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changePassword } from "@/app/[locale]/(app)/settings/profile/actions";
import { PasswordChangeForm } from "./password-change-form";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/profile/actions", () => ({
	changePassword: vi.fn(),
}));

describe("PasswordChangeForm", () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(cleanup);

	it("re-enables submission and reports the existing error when password change rejects", async () => {
		const user = userEvent.setup();
		vi.mocked(changePassword).mockRejectedValue(new Error("Network failed"));
		render(<PasswordChangeForm />);

		await user.type(screen.getByLabelText("Current Password"), "OldPassword1!");
		await user.type(screen.getByLabelText("New Password"), "NewPassword1!");
		await user.type(screen.getByLabelText("Confirm New Password"), "NewPassword1!");
		await user.click(screen.getByRole("button", { name: "Change Password" }));

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Change Password" })).toHaveProperty(
				"disabled",
				false,
			),
		);
		expect(toast.error).toHaveBeenCalledWith("Failed to change password");
		expect(toast.success).not.toHaveBeenCalled();
		expect((screen.getByLabelText("Current Password") as HTMLInputElement).value).toBe(
			"OldPassword1!",
		);
		expect((screen.getByLabelText("New Password") as HTMLInputElement).value).toBe("NewPassword1!");
	});

	it("shows accessible inline validation errors without calling changePassword", async () => {
		const user = userEvent.setup();
		render(<PasswordChangeForm />);

		await user.type(screen.getByLabelText("New Password"), "short");
		await user.type(screen.getByLabelText("Confirm New Password"), "different");
		await user.click(screen.getByRole("button", { name: "Change Password" }));

		expect(await screen.findByText("Current password is required")).toBeTruthy();
		expect(screen.getByText("Password must be at least 12 characters")).toBeTruthy();
		expect(screen.getByText("Passwords do not match")).toBeTruthy();
		expect(screen.getByLabelText("Current Password").getAttribute("aria-invalid")).toBe("true");
		expect(changePassword).not.toHaveBeenCalled();
	});

	it("shows inline current-password error and preserves inputs when server rejects current password", async () => {
		const user = userEvent.setup();
		vi.mocked(changePassword).mockResolvedValue({
			success: false,
			error: "Current password is incorrect",
		});
		render(<PasswordChangeForm />);

		await user.type(screen.getByLabelText("Current Password"), "WrongPassword1!");
		await user.type(screen.getByLabelText("New Password"), "NewPassword123!");
		await user.type(screen.getByLabelText("Confirm New Password"), "NewPassword123!");
		await user.click(screen.getByRole("button", { name: "Change Password" }));

		expect(await screen.findByText("Current password is incorrect")).toBeTruthy();
		expect((screen.getByLabelText("Current Password") as HTMLInputElement).value).toBe(
			"WrongPassword1!",
		);
		expect((screen.getByLabelText("New Password") as HTMLInputElement).value).toBe(
			"NewPassword123!",
		);
		expect((screen.getByLabelText("Confirm New Password") as HTMLInputElement).value).toBe(
			"NewPassword123!",
		);
	});

	it("blocks duplicate submission while pending and resets values on success", async () => {
		const user = userEvent.setup();
		let finish!: (result: { success: true }) => void;
		vi.mocked(changePassword).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		render(<PasswordChangeForm />);

		await user.type(screen.getByLabelText("Current Password"), "OldPassword123!");
		await user.type(screen.getByLabelText("New Password"), "NewPassword123!");
		await user.type(screen.getByLabelText("Confirm New Password"), "NewPassword123!");

		const submitButton = screen.getByRole("button", { name: "Change Password" });
		await user.click(submitButton);
		await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(1));
		expect(screen.getByRole("button", { name: "Saving..." })).toHaveProperty("disabled", true);
		await user.click(screen.getByRole("button", { name: "Saving..." }));
		expect(changePassword).toHaveBeenCalledTimes(1);

		finish({ success: true });
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith("Password changed successfully"),
		);
		expect((screen.getByLabelText("Current Password") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("New Password") as HTMLInputElement).value).toBe("");
	});
});
