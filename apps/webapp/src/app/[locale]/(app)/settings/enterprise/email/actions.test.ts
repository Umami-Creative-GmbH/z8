import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	revalidatePath: vi.fn(),
	requireAccess: vi.fn(),
	findFirst: vi.fn(),
	insert: vi.fn(),
	values: vi.fn(),
	update: vi.fn(),
	set: vi.fn(),
	where: vi.fn(),
	delete: vi.fn(),
	storeOrgSecret: vi.fn(),
	deleteOrgSecret: vi.fn(),
	hasOrgSecret: vi.fn(),
	getSecretStoreStatus: vi.fn(),
	sendTestEmail: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("@/db", () => ({
	db: {
		insert: mocks.insert,
		update: mocks.update,
		delete: mocks.delete,
		query: {
			organizationEmailConfig: {
				findFirst: mocks.findFirst,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	organizationEmailConfig: {
		organizationId: "organizationEmailConfig.organizationId",
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.requireAccess,
}));

vi.mock("@/lib/email/email-service", () => ({
	sendTestEmail: mocks.sendTestEmail,
}));

vi.mock("@/lib/vault", () => ({
	deleteOrgSecret: mocks.deleteOrgSecret,
	getSecretStoreStatus: mocks.getSecretStoreStatus,
	hasOrgSecret: mocks.hasOrgSecret,
	storeOrgSecret: mocks.storeOrgSecret,
}));

import { getEmailConfig, getSecretStoreConnectionStatus, saveEmailConfig } from "./actions";

describe("enterprise email config actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireAccess.mockResolvedValue({ organizationId: "org-1" });
		mocks.findFirst.mockResolvedValue(null);
		mocks.where.mockResolvedValue(undefined);
		mocks.set.mockReturnValue({ where: mocks.where });
		mocks.update.mockReturnValue({ set: mocks.set });
		mocks.values.mockResolvedValue(undefined);
		mocks.insert.mockReturnValue({ values: mocks.values });
		mocks.getSecretStoreStatus.mockResolvedValue({
			provider: "vault",
			available: true,
			initialized: true,
			sealed: false,
			address: "http://vault.test:8200",
			reason: "available",
		});
	});

	it("rejects saving another organization's config without writing DB or secrets", async () => {
		const result = await saveEmailConfig("other-org", {
			transportType: "resend",
			fromEmail: "admin@example.com",
			isActive: true,
			resendApiKey: "secret-key",
		});

		expect(result).toEqual({
			success: false,
			error: "Organization access mismatch",
		});
		expect(mocks.findFirst).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.storeOrgSecret).not.toHaveBeenCalled();
		expect(mocks.deleteOrgSecret).not.toHaveBeenCalled();
	});

	it("rejects another organization's secret store status without checking the provider", async () => {
		await expect(getSecretStoreConnectionStatus("other-org")).rejects.toThrow(
			"Organization access mismatch",
		);
		expect(mocks.getSecretStoreStatus).not.toHaveBeenCalled();
	});

	it("saves smtpIpMode for SMTP configs without storing it as a secret", async () => {
		const result = await saveEmailConfig("org-1", {
			transportType: "smtp",
			fromEmail: "noreply@example.com",
			fromName: "Example",
			isActive: true,
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			smtpSecure: false,
			smtpRequireTls: true,
			smtpUsername: "smtp-user",
			smtpPassword: "smtp-password",
			smtpIpMode: "ipv6",
		});

		expect(result).toEqual({ success: true });
		expect(mocks.insert).toHaveBeenCalledTimes(1);
		expect(mocks.values).toHaveBeenCalledWith(
			expect.objectContaining({
				smtpIpMode: "ipv6",
			}),
		);
		expect(mocks.storeOrgSecret).toHaveBeenCalledTimes(1);
		expect(mocks.storeOrgSecret).toHaveBeenCalledWith(
			"org-1",
			"email/smtp_password",
			"smtp-password",
		);
	});

	it("rejects empty smtpIpMode without writing DB or secrets", async () => {
		const result = await saveEmailConfig("org-1", {
			transportType: "smtp",
			fromEmail: "noreply@example.com",
			isActive: true,
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			smtpUsername: "smtp-user",
			smtpPassword: "smtp-password",
			smtpIpMode: "",
		} as Parameters<typeof saveEmailConfig>[1]);

		expect(result).toEqual({ success: false, error: "Invalid SMTP IP mode" });
		expect(mocks.findFirst).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.values).not.toHaveBeenCalled();
		expect(mocks.storeOrgSecret).not.toHaveBeenCalled();
		expect(mocks.deleteOrgSecret).not.toHaveBeenCalled();
	});

	it("returns smtpIpMode from saved organization email config", async () => {
		mocks.findFirst.mockResolvedValue({
			id: "config-1",
			organizationId: "org-1",
			transportType: "smtp",
			fromEmail: "noreply@example.com",
			fromName: "Example",
			isActive: true,
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			smtpSecure: false,
			smtpRequireTls: true,
			smtpUsername: "smtp-user",
			smtpIpMode: "ipv4",
			lastTestAt: null,
			lastTestSuccess: null,
			lastTestError: null,
			createdAt: new Date("2026-06-04T00:00:00.000Z"),
			updatedAt: new Date("2026-06-04T00:00:00.000Z"),
		});
		mocks.hasOrgSecret.mockResolvedValue(false);

		const result = await getEmailConfig("org-1");

		expect(result).toEqual(
			expect.objectContaining({
				smtpIpMode: "ipv4",
				hasResendApiKey: false,
				hasSmtpPassword: false,
			}),
		);
	});
});
