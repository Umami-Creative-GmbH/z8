/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSSOProviderAction } from "@/app/[locale]/(app)/settings/enterprise/actions";
import { SSOProviderDialog } from "./sso-provider-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The actions are mocked as plain values; the result unwrap is identity here.
vi.mock("@/components/settings/enterprise/action-data", () => ({
	actionData: <T,>(result: Promise<T>) => result,
}));
vi.mock("@/app/[locale]/(app)/settings/enterprise/actions", () => ({
	registerSSOProviderAction: vi.fn(),
}));

describe("SSOProviderDialog", () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(cleanup);

	it("derives Entra settings and submits only the existing registration payload", async () => {
		const user = userEvent.setup();
		const onProviderAdded = vi.fn();
		const onOpenChange = vi.fn();
		const provider = {
			id: "sso-1",
			providerId: "generated",
			issuer: "",
			domain: "example.com",
			domainVerified: false,
			domainVerificationToken: null,
			createdAt: null,
		};
		vi.mocked(registerSSOProviderAction).mockResolvedValue(provider);
		render(
			<SSOProviderDialog
				open
				callbackUrl="https://acme.z8.test/api/auth/sso/callback"
				onProviderAdded={onProviderAdded}
				onOpenChange={onOpenChange}
			/>,
		);

		expect(screen.queryByLabelText("Provider ID")).toBeNull();
		expect(screen.queryByLabelText("Issuer URL")).toBeNull();
		await user.type(screen.getByLabelText("Email Domain"), "Example.COM");
		await user.type(
			screen.getByLabelText("Directory (tenant) ID"),
			"11111111-2222-3333-4444-555555555555",
		);
		await user.type(
			screen.getByLabelText("Application (client) ID"),
			"app-client-id",
		);
		await user.type(
			screen.getByLabelText("Client secret Value"),
			"private-client-secret",
		);
		await user.click(screen.getByRole("button", { name: "Add Provider" }));

		await waitFor(() => expect(onProviderAdded).toHaveBeenCalledWith(provider));
		expect(registerSSOProviderAction).toHaveBeenCalledWith({
			providerId: expect.stringMatching(/^entra-[0-9a-f-]{36}$/),
			issuer:
				"https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0",
			domain: "example.com",
			clientId: "app-client-id",
			clientSecret: "private-client-secret",
		});
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("copies the organization callback before credentials exist and excludes secrets from the IT checklist", async () => {
		const user = userEvent.setup();
		const writeText = vi.spyOn(navigator.clipboard, "writeText");
		render(
			<SSOProviderDialog
				open
				callbackUrl="https://organization.z8.test/api/auth/sso/callback"
				onProviderAdded={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Copy callback URL" }));
		expect(writeText).toHaveBeenLastCalledWith(
			"https://organization.z8.test/api/auth/sso/callback",
		);
		await user.click(screen.getByRole("button", { name: "Copy IT checklist" }));
		expect(writeText.mock.lastCall?.[0]).toContain(
			"Accounts in this organizational directory only",
		);
		await user.type(screen.getByLabelText("Email Domain"), "example.com");
		await user.type(
			screen.getByLabelText("Client secret Value"),
			"never-include-this-secret",
		);
		await user.click(screen.getByRole("button", { name: "Copy IT checklist" }));
		const checklist = writeText.mock.lastCall?.[0];
		expect(checklist).toContain("example.com");
		expect(checklist).toContain(
			"https://organization.z8.test/api/auth/sso/callback",
		);
		expect(checklist).not.toContain("never-include-this-secret");
		expect(registerSSOProviderAction).not.toHaveBeenCalled();
	});

	it("rejects a tenant-independent Entra issuer and clears credentials when switching setup modes", async () => {
		const user = userEvent.setup();
		render(
			<SSOProviderDialog
				open
				callbackUrl="https://organization.z8.test/api/auth/sso/callback"
				onProviderAdded={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);
		await user.type(screen.getByLabelText("Email Domain"), "example.com");
		await user.type(screen.getByLabelText("Directory (tenant) ID"), "common");
		await user.type(
			screen.getByLabelText("Application (client) ID"),
			"client-id",
		);
		await user.type(
			screen.getByLabelText("Client secret Value"),
			"secret-to-clear",
		);
		await user.click(screen.getByRole("button", { name: "Add Provider" }));
		expect(
			screen.getByText("Enter the Directory (tenant) ID as a complete UUID."),
		).toBeTruthy();
		expect(registerSSOProviderAction).not.toHaveBeenCalled();
		await user.click(
			screen.getByRole("combobox", { name: "Identity provider" }),
		);
		await user.click(
			await screen.findByRole("option", {
				name: "Other provider / manual OIDC",
			}),
		);
		expect(screen.getByLabelText("Client Secret")).toHaveProperty("value", "");
		expect(screen.getByLabelText("Issuer URL")).toHaveProperty("value", "");
		expect(screen.queryByLabelText("Directory (tenant) ID")).toBeNull();
	});

	it("offers selectable checklist text if clipboard permission is denied", async () => {
		const user = userEvent.setup();
		vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(
			new Error("Clipboard denied"),
		);
		render(
			<SSOProviderDialog
				open
				callbackUrl="https://organization.z8.test/api/auth/sso/callback"
				onProviderAdded={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Copy IT checklist" }));
		expect((await screen.findByRole("alert")).textContent).toContain(
			"Select and copy the text manually",
		);
		expect(
			screen.getByRole("textbox", { name: "Copy IT checklist" }),
		).toHaveProperty(
			"value",
			expect.stringContaining(
				"https://organization.z8.test/api/auth/sso/callback",
			),
		);
	});

	it("discards credentials when the setup panel closes", async () => {
		const user = userEvent.setup();
		const props = {
			callbackUrl: "https://organization.z8.test/api/auth/sso/callback",
			onProviderAdded: vi.fn(),
			onOpenChange: vi.fn(),
		};
		const { rerender } = render(<SSOProviderDialog {...props} open />);
		await user.type(
			screen.getByLabelText("Client secret Value"),
			"secret-to-forget",
		);
		rerender(<SSOProviderDialog {...props} open={false} />);
		rerender(<SSOProviderDialog {...props} open />);
		expect(screen.getByLabelText("Client secret Value")).toHaveProperty(
			"value",
			"",
		);
	});

	it("re-enables add and keeps the dialog open when registration rejects", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		const onProviderAdded = vi.fn();
		vi.mocked(registerSSOProviderAction).mockRejectedValue(
			new Error("Issuer unavailable"),
		);
		render(
			<SSOProviderDialog
				callbackUrl="https://acme.z8.test/api/auth/sso/callback"
				open
				onOpenChange={onOpenChange}
				onProviderAdded={onProviderAdded}
			/>,
		);

		await user.click(
			screen.getByRole("combobox", { name: "Identity provider" }),
		);
		await user.click(
			await screen.findByRole("option", {
				name: "Other provider / manual OIDC",
			}),
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
