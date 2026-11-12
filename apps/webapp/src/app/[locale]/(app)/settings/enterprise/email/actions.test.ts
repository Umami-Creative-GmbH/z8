import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	revalidatePath: vi.fn(),
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

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				insert: mocks.insert,
				update: mocks.update,
				delete: mocks.delete,
				query: { organizationEmailConfig: { findFirst: mocks.findFirst } },
			},
		}),
	);
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/email/email-service", () => ({ sendTestEmail: mocks.sendTestEmail }));
vi.mock("@/lib/vault", () => ({
	deleteOrgSecret: mocks.deleteOrgSecret,
	getSecretStoreStatus: mocks.getSecretStoreStatus,
	hasOrgSecret: mocks.hasOrgSecret,
	storeOrgSecret: mocks.storeOrgSecret,
}));

const {
	deleteEmailConfig,
	getEmailConfig,
	getSecretStoreConnectionStatus,
	saveEmailConfig,
	testEmailConfig,
} = await import("./actions");

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};

const smtpConfig = {
	transportType: "smtp" as const,
	fromEmail: "noreply@example.com",
	fromName: "Example",
	isActive: true,
	smtpHost: "smtp.example.com",
	smtpPort: 587,
	smtpSecure: false,
	smtpRequireTls: true,
	smtpUsername: "smtp-user",
	smtpPassword: "smtp-password",
	smtpIpMode: "ipv6" as const,
};

const storedConfig = {
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
};

function expectNoWrites() {
	expect(mocks.insert).not.toHaveBeenCalled();
	expect(mocks.update).not.toHaveBeenCalled();
	expect(mocks.delete).not.toHaveBeenCalled();
	expect(mocks.storeOrgSecret).not.toHaveBeenCalled();
	expect(mocks.deleteOrgSecret).not.toHaveBeenCalled();
}

describe("enterprise email config actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdmin;
		mocks.findFirst.mockResolvedValue(null);
		mocks.where.mockResolvedValue(undefined);
		mocks.set.mockReturnValue({ where: mocks.where });
		mocks.update.mockReturnValue({ set: mocks.set });
		mocks.values.mockResolvedValue(undefined);
		mocks.insert.mockReturnValue({ values: mocks.values });
		mocks.delete.mockReturnValue({ where: mocks.where });
		mocks.getSecretStoreStatus.mockResolvedValue({ provider: "vault", available: true });
	});

	it.each([
		["getEmailConfig", () => getEmailConfig()],
		["saveEmailConfig", () => saveEmailConfig(smtpConfig)],
		["testEmailConfig", () => testEmailConfig({ testEmail: "a@example.com" })],
		["deleteEmailConfig", () => deleteEmailConfig()],
		["getSecretStoreConnectionStatus", () => getSecretStoreConnectionStatus()],
	] as const)(
		"%s refuses a scoped manager without touching config or secrets",
		async (_name, call) => {
			mocks.caller = {
				...orgAdmin,
				membershipRole: "member",
				employee: { id: "employee-1", role: "manager", former: false },
			};

			await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
			expect(mocks.findFirst).not.toHaveBeenCalled();
			expect(mocks.getSecretStoreStatus).not.toHaveBeenCalled();
			expect(mocks.sendTestEmail).not.toHaveBeenCalled();
			expectNoWrites();
		},
	);

	it("saves smtpIpMode for SMTP configs of the session's organization without storing it as a secret", async () => {
		await expect(saveEmailConfig(smtpConfig)).resolves.toEqual({ success: true, data: undefined });

		expect(mocks.values).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1", smtpIpMode: "ipv6" }),
		);
		expect(mocks.storeOrgSecret).toHaveBeenCalledTimes(1);
		expect(mocks.storeOrgSecret).toHaveBeenCalledWith(
			"org-1",
			"email/smtp_password",
			"smtp-password",
		);
	});

	it("refuses an empty smtpIpMode without writing", async () => {
		const result = await saveEmailConfig({ ...smtpConfig, smtpIpMode: "" } as never);

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Invalid SMTP IP mode",
		});
		expect(mocks.findFirst).not.toHaveBeenCalled();
		expectNoWrites();
	});

	it("refuses an SMTP config without host, port or username", async () => {
		const result = await saveEmailConfig({ ...smtpConfig, smtpHost: "" });

		expect(result).toMatchObject({
			success: false,
			error: "SMTP host, port, and username are required",
		});
		expectNoWrites();
	});

	it("returns smtpIpMode from the saved config", async () => {
		mocks.findFirst.mockResolvedValue(storedConfig);
		mocks.hasOrgSecret.mockResolvedValue(false);

		await expect(getEmailConfig()).resolves.toMatchObject({
			success: true,
			data: { smtpIpMode: "ipv4", hasResendApiKey: false, hasSmtpPassword: false },
		});
	});

	it("returns null smtpIpMode for a Resend config", async () => {
		mocks.findFirst.mockResolvedValue({
			...storedConfig,
			transportType: "resend",
			smtpIpMode: null,
		});
		mocks.hasOrgSecret.mockResolvedValue(false);

		await expect(getEmailConfig()).resolves.toMatchObject({
			success: true,
			data: { transportType: "resend", smtpIpMode: null },
		});
	});

	it("reports a failed test email with the provider's answer and records it", async () => {
		mocks.sendTestEmail.mockResolvedValue({ success: false, error: "Connection refused" });

		await expect(testEmailConfig({ testEmail: "a@example.com" })).resolves.toMatchObject({
			success: false,
			error: "Connection refused",
		});
		expect(mocks.sendTestEmail).toHaveBeenCalledWith("a@example.com", "org-1");
		expect(mocks.set).toHaveBeenCalledWith(
			expect.objectContaining({ lastTestSuccess: false, lastTestError: "Connection refused" }),
		);
	});
});
