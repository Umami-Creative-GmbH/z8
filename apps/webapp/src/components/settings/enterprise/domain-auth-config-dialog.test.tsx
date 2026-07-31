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
	it("loads and saves the custom-domain cookie consent script", async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);

		render(
			<DomainAuthConfigDialog
				open={true}
				onOpenChange={vi.fn()}
				domain={domain}
				organizationId="org_123"
				onSave={onSave}
			/>,
		);

		const textarea = screen.getByLabelText("Cookie Consent Script");
		expect((textarea as HTMLTextAreaElement).value).toBe(
			"<script>existing()</script>",
		);

		fireEvent.change(textarea, {
			target: { value: "<script>updated()</script>" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

		expect(onSave).toHaveBeenCalledWith(
			"domain_123",
			expect.objectContaining({
				cookieConsentScript: "<script>updated()</script>",
				turnstileSiteKey: "0x4AAA-site-key",
			}),
			undefined,
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
				organizationId="org_123"
				onSave={onSave}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Save Configuration" }),
			).toHaveProperty("disabled", false),
		);
		expect(onOpenChange).not.toHaveBeenCalled();
	});
});
