import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	configFindFirst: vi.fn(),
	mappingFindFirst: vi.fn(),
	update: vi.fn(),
	set: vi.fn(),
	where: vi.fn(),
	isTelegramEnabledForOrganization: vi.fn(),
	generateLinkCode: vi.fn(),
	unlinkTelegramUser: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				query: {
					telegramBotConfig: { findFirst: mocks.configFindFirst },
					telegramUserMapping: { findFirst: mocks.mappingFindFirst },
				},
				update: mocks.update,
			},
		}),
	);
});

vi.mock("@/lib/telegram", () => ({
	isTelegramEnabledForOrganization: mocks.isTelegramEnabledForOrganization,
	generateLinkCode: mocks.generateLinkCode,
	unlinkTelegramUser: mocks.unlinkTelegramUser,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

vi.mock("@/lib/vault", () => ({
	deleteOrgSecret: vi.fn(),
	getOrgSecret: vi.fn(),
	storeOrgSecret: vi.fn(),
}));

const {
	generateTelegramLinkCode,
	getTelegramConfig,
	getUserTelegramLink,
	unlinkTelegramAccount,
	updateTelegramSettings,
} = await import("./actions");

const settings = {
	enableApprovals: true,
	enableCommands: false,
	enableDailyDigest: true,
	enableEscalations: false,
	digestTime: "09:30",
	digestTimezone: "Europe/Berlin",
	escalationTimeoutHours: 12,
};

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};
const orgMember: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.where.mockResolvedValue(undefined);
	mocks.set.mockReturnValue({ where: mocks.where });
	mocks.update.mockReturnValue({ set: mocks.set });
	mocks.configFindFirst.mockResolvedValue(null);
	mocks.mappingFindFirst.mockResolvedValue(null);
	mocks.isTelegramEnabledForOrganization.mockResolvedValue(true);
	mocks.generateLinkCode.mockResolvedValue({
		code: "ABC123",
		expiresAt: new Date("2026-11-07T12:00:00Z"),
	});
	mocks.unlinkTelegramUser.mockResolvedValue(undefined);
});

describe("Telegram settings actions", () => {
	it.each([
		["an org member", orgMember],
		["a pending membership", { ...orgAdmin, membershipRole: null }],
		[
			"a former employee",
			{ ...orgAdmin, employee: { id: "employee-1", role: "admin" as const, former: true } },
		],
		["a signed-out caller", null],
	])("does not update settings for %s", async (_case, caller) => {
		mocks.caller = caller;

		const result = await updateTelegramSettings(settings);

		expect(result).toMatchObject({ success: false });
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("reads the configuration of the caller's active organization only", async () => {
		await getTelegramConfig();

		expect(mocks.configFindFirst).toHaveBeenCalledTimes(1);
		mocks.caller = orgMember;
		await expect(getTelegramConfig()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.configFindFirst).toHaveBeenCalledTimes(1);
	});

	it.each([
		["digest time", { ...settings, digestTime: "9:30" }, "Digest time must use HH:mm format"],
		[
			"digest timezone",
			{ ...settings, digestTimezone: "+05:45" },
			"Digest timezone must be a valid timezone",
		],
		[
			"boolean setting",
			{ ...settings, enableApprovals: "yes" },
			"Enable approvals must be a boolean",
		],
		[
			"escalation timeout",
			{ ...settings, escalationTimeoutHours: 0 },
			"Escalation timeout must be at least 1 hour",
		],
	] as const)("rejects invalid %s before updating", async (_field, invalidSettings, error) => {
		const result = await updateTelegramSettings(invalidSettings as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError", error });
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("rejects non-object settings before updating", async () => {
		const result = await updateTelegramSettings(null as never);

		expect(result).toMatchObject({ success: false, error: "Settings are required" });
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it.each(["UTC", "Europe/Berlin", "America/New_York"])(
		"updates a valid digest timezone %s",
		async (digestTimezone) => {
			const result = await updateTelegramSettings({ ...settings, digestTimezone });

			expect(result).toEqual({ success: true, data: undefined });
			expect(mocks.set).toHaveBeenCalledWith({ ...settings, digestTimezone });
		},
	);
});

describe("Telegram user linking actions", () => {
	beforeEach(() => {
		mocks.caller = orgMember;
	});

	it("generates a link code for the caller in their active organization", async () => {
		const result = await generateTelegramLinkCode();

		expect(result).toEqual({
			success: true,
			data: { code: "ABC123", expiresAt: "2026-11-07T12:00:00.000Z" },
		});
		expect(mocks.generateLinkCode).toHaveBeenCalledWith("user-1", "org-1");
	});

	it("refuses a link code to a caller who is not an org member", async () => {
		mocks.caller = { ...orgMember, membershipRole: null };

		const result = await generateTelegramLinkCode();

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.isTelegramEnabledForOrganization).not.toHaveBeenCalled();
		expect(mocks.generateLinkCode).not.toHaveBeenCalled();
	});

	it("refuses a link code while Telegram is not configured", async () => {
		mocks.isTelegramEnabledForOrganization.mockResolvedValueOnce(false);

		await expect(generateTelegramLinkCode()).resolves.toMatchObject({
			success: false,
			error: "Telegram is not configured for this organization",
		});
		expect(mocks.generateLinkCode).not.toHaveBeenCalled();
	});

	it("refuses the link status and unlinking to a former employee", async () => {
		mocks.caller = { ...orgMember, employee: { id: "employee-1", role: "employee", former: true } };

		expect(await getUserTelegramLink()).toMatchObject({ success: false });
		expect(await unlinkTelegramAccount()).toMatchObject({ success: false });
		expect(mocks.mappingFindFirst).not.toHaveBeenCalled();
		expect(mocks.unlinkTelegramUser).not.toHaveBeenCalled();
	});

	it("unlinks the caller's own account", async () => {
		await expect(unlinkTelegramAccount()).resolves.toEqual({ success: true, data: undefined });
		expect(mocks.unlinkTelegramUser).toHaveBeenCalledWith("user-1", "org-1");
	});
});
