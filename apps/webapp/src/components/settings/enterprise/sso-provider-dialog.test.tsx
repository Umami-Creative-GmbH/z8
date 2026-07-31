/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSSOProviderAction } from "@/app/[locale]/(app)/settings/enterprise/actions";
import { SSOProviderDialog } from "./sso-provider-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/enterprise/actions", () => ({
	registerSSOProviderAction: vi.fn(),
}));

describe("SSOProviderDialog", () => {
	beforeEach(() => vi.clearAllMocks());

	it("re-enables add and keeps the dialog open when registration rejects", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		const onProviderAdded = vi.fn();
		vi.mocked(registerSSOProviderAction).mockRejectedValue(
			new Error("Issuer unavailable"),
		);
		render(
			<SSOProviderDialog
				open
				onOpenChange={onOpenChange}
				onProviderAdded={onProviderAdded}
			/>,
		);

		await user.type(screen.getByLabelText("Provider ID"), "acme-okta");
		await user.type(
			screen.getByLabelText("Issuer URL"),
			"https://acme.okta.com",
		);
		await user.type(screen.getByLabelText("Email Domain"), "example.com");
		await user.type(screen.getByLabelText("Client ID"), "client-id");
		await user.type(screen.getByLabelText("Client Secret"), "client-secret");
		await user.click(screen.getByRole("button", { name: "Add Provider" }));

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Add Provider" }),
			).toHaveProperty("disabled", false),
		);
		expect(toast.error).toHaveBeenCalledWith("Issuer unavailable");
		expect(toast.success).not.toHaveBeenCalled();
		expect(onProviderAdded).not.toHaveBeenCalled();
		expect(onOpenChange).not.toHaveBeenCalled();
	});
});
