/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

	it("re-enables submission and reports the existing error when password change rejects", async () => {
		const user = userEvent.setup();
		vi.mocked(changePassword).mockRejectedValue(new Error("Network failed"));
		render(<PasswordChangeForm />);

		await user.type(screen.getByLabelText("Current Password"), "OldPassword1!");
		await user.type(screen.getByLabelText("New Password"), "NewPassword1!");
		await user.type(
			screen.getByLabelText("Confirm New Password"),
			"NewPassword1!",
		);
		await user.click(screen.getByRole("button", { name: "Change Password" }));

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Change Password" }),
			).toHaveProperty("disabled", false),
		);
		expect(toast.error).toHaveBeenCalledWith("Failed to change password");
		expect(toast.success).not.toHaveBeenCalled();
	});
});
