/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DomainAuthConfigDialog } from "./domain-auth-config-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const domain = {
	id: "domain_123",
	domain: "login.acme.test",
	authConfig: {
		emailPasswordEnabled: true,
		socialProvidersEnabled: [],
		ssoEnabled: false,
		passkeyEnabled: true,
		turnstileSiteKey: "0x4AAA-site-key",
		cookieConsentScript: "<script>existing()</script>",
	},
};

describe("DomainAuthConfigDialog", () => {
	it("edits the SSO label and icon and can restore the defaults", async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		render(
			<DomainAuthConfigDialog
				open
				onOpenChange={vi.fn()}
				organizationId="org_123"
				ssoProviderAvailable
				onSave={onSave}
				domain={{
					...domain,
					authConfig: {
						...domain.authConfig,
						ssoEnabled: true,
						ssoButtonLabel: "Company login",
						ssoButtonIcon: "key",
					},
				}}
			/>,
		);
		const label = screen.getByLabelText("SSO button label (optional)");
		const icon = screen.getByRole("combobox", { name: "SSO button icon" });
		expect(label).toHaveProperty("value", "Company login");
		expect(icon.textContent).toContain("Key");
		fireEvent.change(label, { target: { value: "  Mit Microsoft anmelden  " } });
		fireEvent.click(icon);
		fireEvent.click(await screen.findByRole("option", { name: "Microsoft" }));
		const save = screen.getByRole("button", { name: "Save Configuration" });
		fireEvent.click(save);
		await waitFor(() =>
			expect(onSave).toHaveBeenLastCalledWith(
				domain.id,
				expect.objectContaining({
					ssoButtonLabel: "Mit Microsoft anmelden",
					ssoButtonIcon: "microsoft",
				}),
				undefined,
			),
		);
		fireEvent.change(label, { target: { value: " " } });
		fireEvent.click(icon);
		fireEvent.click(await screen.findByRole("option", { name: "Fingerprint" }));
		fireEvent.click(save);
		await waitFor(() =>
			expect(onSave).toHaveBeenLastCalledWith(
				domain.id,
				expect.objectContaining({
					ssoButtonLabel: undefined,
					ssoButtonIcon: undefined,
				}),
				undefined,
			),
		);
	});
	it("loads and saves the custom-domain cookie consent script", async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);

		render(
			<DomainAuthConfigDialog
				open={true}
				onOpenChange={vi.fn()}
				domain={domain}
				ssoProviderAvailable={false}
				organizationId="org_123"
				onSave={onSave}
			/>,
		);

		const textarea = screen.getByLabelText("Cookie Consent Script");
		expect((textarea as HTMLTextAreaElement).value).toBe("<script>existing()</script>");

		fireEvent.change(textarea, {
			target: { value: "<script>updated()</script>" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith(
				"domain_123",
				expect.objectContaining({
					cookieConsentScript: "<script>updated()</script>",
					turnstileSiteKey: "0x4AAA-site-key",
				}),
				undefined,
			),
		);
	});

	it("re-enables save and keeps the panel open when saving rejects", async () => {
		const onOpenChange = vi.fn();
		const onSave = vi.fn().mockRejectedValue(new Error("Network failed"));

		render(
			<DomainAuthConfigDialog
				open={true}
				onOpenChange={onOpenChange}
				domain={domain}
				ssoProviderAvailable={false}
				organizationId="org_123"
				onSave={onSave}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Save Configuration" })).toHaveProperty(
				"disabled",
				false,
			),
		);
		expect(onOpenChange).not.toHaveBeenCalled();
	});
});
