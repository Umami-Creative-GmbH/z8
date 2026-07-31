/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateBrandingAction } from "@/app/[locale]/(app)/settings/enterprise/actions";
import { BrandingForm } from "./branding-form";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/enterprise/actions", () => ({
	updateBrandingAction: vi.fn(),
}));
vi.mock("@/hooks/use-image-upload", () => ({
	useImageUpload: () => ({
		addFile: vi.fn(),
		isUploading: false,
		previewUrl: null,
		progress: 0,
	}),
}));

describe("BrandingForm", () => {
	beforeEach(() => vi.clearAllMocks());

	it("re-enables save and uses the existing error toast when saving rejects", async () => {
		const user = userEvent.setup();
		vi.mocked(updateBrandingAction).mockRejectedValue(
			new Error("Network failed"),
		);
		render(
			<BrandingForm
				organizationId="org_1"
				initialBranding={{
					logoUrl: null,
					backgroundImageUrl: null,
					appName: null,
					primaryColor: null,
					accentColor: null,
				}}
			/>,
		);

		await user.click(
			screen.getByRole("button", { name: "Save Branding Settings" }),
		);

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Save Branding Settings" }),
			).toHaveProperty("disabled", false),
		);
		expect(toast.error).toHaveBeenCalledWith(
			"Failed to save branding settings",
		);
		expect(toast.success).not.toHaveBeenCalled();
	});
});
