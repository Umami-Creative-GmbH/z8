/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SecretStoreStatus } from "@/lib/vault";
import { EmailConfigForm } from "./email-config-form";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("@/app/[locale]/(app)/settings/enterprise/email/actions", () => ({
	deleteEmailConfig: vi.fn(),
	saveEmailConfig: vi.fn(),
	testEmailConfig: vi.fn(),
}));

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class ResizeObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});

function renderForm(secretStoreStatus: SecretStoreStatus) {
	return render(
		<EmailConfigForm
			organizationId="org_123"
			initialConfig={null}
			secretStoreStatus={secretStoreStatus}
		/>,
	);
}

describe("EmailConfigForm", () => {
	it("shows Scaleway connected status when the organization key is verified", () => {
		renderForm({ provider: "scaleway", available: true, reason: "available" });

		expect(screen.getByText("Scaleway Secret Store Ready")).toBeTruthy();
		expect(
			screen.getByText(
				"This organization has a verified Scaleway Key Manager key for encrypted secret storage.",
			),
		).toBeTruthy();
	});

	it("shows Scaleway pending status before the first key is generated", () => {
		renderForm({ provider: "scaleway", available: false, reason: "missing-key" });

		expect(screen.getByText("Scaleway Key Not Generated Yet")).toBeTruthy();
		expect(
			screen.getByText(
				"A Scaleway organization key will be generated when you save a secret such as a Resend API key or SMTP password.",
			),
		).toBeTruthy();
	});

	it("shows Scaleway unavailable status when an existing key cannot be verified", () => {
		renderForm({ provider: "scaleway", available: false, reason: "invalid-key" });

		expect(screen.getByText("Scaleway Secret Store Unavailable")).toBeTruthy();
		expect(
			screen.getByText(
				"The configured Scaleway organization key could not be verified. Secrets cannot be stored securely until this is fixed.",
			),
		).toBeTruthy();
	});

	it("preserves Vault connected status when Vault is available", () => {
		renderForm({
			provider: "vault",
			available: true,
			initialized: true,
			sealed: false,
			address: "https://vault.test",
			reason: "available",
		});

		expect(screen.getByText("Vault Connected")).toBeTruthy();
		expect(screen.getByText("Secrets are stored securely in HashiCorp Vault.")).toBeTruthy();
	});

	it("preserves Vault unavailable status when Vault is sealed but unavailable", () => {
		renderForm({
			provider: "vault",
			available: false,
			initialized: true,
			sealed: true,
			address: "https://vault.test",
			reason: "sealed",
		});

		expect(screen.getByText("Vault Unavailable")).toBeTruthy();
		expect(
			screen.getByText("HashiCorp Vault is not available. Secrets cannot be stored securely."),
		).toBeTruthy();
		expect(screen.queryByText("Vault Sealed")).toBeNull();
	});

	it("preserves Vault sealed status when Vault is available but sealed", () => {
		renderForm({
			provider: "vault",
			available: true,
			initialized: true,
			sealed: true,
			address: "https://vault.test",
			reason: "sealed",
		});

		expect(screen.getByText("Vault Sealed")).toBeTruthy();
		expect(screen.getByText("HashiCorp Vault is sealed. Please unseal it to store secrets.")).toBeTruthy();
	});
});
