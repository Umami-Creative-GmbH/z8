import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireUser: vi.fn(),
	requireActiveActor: vi.fn(),
	memberFindFirst: vi.fn(),
	update: vi.fn(),
	set: vi.fn(),
	where: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: { findFirst: mocks.memberFindFirst },
		},
		update: mocks.update,
	},
}));

vi.mock("@/db/schema", () => ({
	telegramBotConfig: {
		organizationId: "telegramOrganizationId",
	},
	telegramUserMapping: {},
}));

vi.mock("@/env", () => ({ env: {} }));

vi.mock("@/lib/auth-helpers", () => ({
	requireUser: mocks.requireUser,
}));

vi.mock("@/lib/auth/organization-action-authorization", () => ({
	runActiveOrganizationActionActorCheck: mocks.requireActiveActor,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/vault", () => ({
	deleteOrgSecret: vi.fn(),
	getOrgSecret: vi.fn(),
	storeOrgSecret: vi.fn(),
}));

const { updateTelegramSettings } = await import("./actions");

const settings = {
	enableApprovals: true,
	enableCommands: false,
	enableDailyDigest: true,
	enableEscalations: false,
	digestTime: "09:30",
	digestTimezone: "Europe/Berlin",
	escalationTimeoutHours: 12,
};

describe("Telegram settings actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireUser.mockResolvedValue({ user: { id: "user-1" } });
		mocks.requireActiveActor.mockResolvedValue({});
		mocks.memberFindFirst.mockResolvedValue({
			id: "member-1",
			userId: "user-1",
			organizationId: "org-1",
			role: "admin",
		});
		mocks.where.mockResolvedValue(undefined);
		mocks.set.mockReturnValue({ where: mocks.where });
		mocks.update.mockReturnValue({ set: mocks.set });
	});

	it.each([
		"pending",
		"rejected",
		"inactive",
	])("does not update settings when the %s actor is denied", async (actorState) => {
		mocks.requireActiveActor.mockRejectedValueOnce(new Error(actorState));

		const result = await updateTelegramSettings("org-1", settings);

		expect(result).toEqual({
			success: false,
			error: "Failed to update Telegram settings",
		});
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it.each([
		[
			"digest time",
			{ ...settings, digestTime: "9:30" },
			"Digest time must use HH:mm format",
		],
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
		const result = await updateTelegramSettings(
			"org-1",
			invalidSettings as never,
		);

		expect(result).toEqual({ success: false, error });
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("rejects non-object settings before updating", async () => {
		const result = await updateTelegramSettings("org-1", null as never);

		expect(result).toEqual({ success: false, error: "Settings are required" });
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it.each([
		"UTC",
		"Europe/Berlin",
		"America/New_York",
	])("updates a valid digest timezone %s", async (digestTimezone) => {
		const result = await updateTelegramSettings("org-1", {
			...settings,
			digestTimezone,
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.set).toHaveBeenCalledWith({ ...settings, digestTimezone });
	});
});
