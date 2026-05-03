import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	revalidatePath: vi.fn(),
	requireAccess: vi.fn(),
	update: vi.fn(),
	set: vi.fn(),
	where: vi.fn(),
	slackFindFirst: vi.fn(),
	discordFindFirst: vi.fn(),
	teamsFindFirst: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("@/db", () => ({
	db: {
		update: mocks.update,
		query: {
			slackWorkspaceConfig: {
				findFirst: mocks.slackFindFirst,
			},
			discordBotConfig: {
				findFirst: mocks.discordFindFirst,
			},
			teamsTenantConfig: {
				findFirst: mocks.teamsFindFirst,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	discordBotConfig: {
		organizationId: "discordOrganizationId",
	},
	slackWorkspaceConfig: {
		organizationId: "slackOrganizationId",
	},
	teamsTenantConfig: {
		organizationId: "teamsOrganizationId",
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.requireAccess,
}));

import {
	getDiscordNotificationChannelConfig,
	getSlackNotificationChannelConfig,
	getTeamsNotificationChannelConfig,
	updateDiscordNotificationChannelSettings,
	updateSlackNotificationChannelSettings,
	updateTeamsNotificationChannelSettings,
} from "./actions";

const settings = {
	enableApprovals: true,
	enableCommands: false,
	enableDailyDigest: true,
	enableEscalations: false,
	digestTime: "09:30",
	digestTimezone: "Europe/Berlin",
	escalationTimeoutHours: 12,
};

describe("notification channel settings actions", () => {
	beforeEach(() => {
		mocks.revalidatePath.mockReset();
		mocks.requireAccess.mockReset();
		mocks.requireAccess.mockResolvedValue({ organizationId: "org-1" });
		mocks.update.mockReset();
		mocks.set.mockReset();
		mocks.where.mockReset();
		mocks.slackFindFirst.mockReset();
		mocks.discordFindFirst.mockReset();
		mocks.teamsFindFirst.mockReset();

		mocks.where.mockResolvedValue(undefined);
		mocks.set.mockReturnValue({ where: mocks.where });
		mocks.update.mockReturnValue({ set: mocks.set });
	});

	it("updates Slack channel settings and revalidates Slack settings", async () => {
		const result = await updateSlackNotificationChannelSettings(settings);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.set).toHaveBeenCalledWith(settings);
		expect(mocks.where).toHaveBeenCalledWith({ eq: ["slackOrganizationId", "org-1"] });
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/slack");
	});

	it("updates Discord channel settings and revalidates Discord settings", async () => {
		const result = await updateDiscordNotificationChannelSettings(settings);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.set).toHaveBeenCalledWith(settings);
		expect(mocks.where).toHaveBeenCalledWith({ eq: ["discordOrganizationId", "org-1"] });
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/discord");
	});

	it("updates Teams channel settings and revalidates Teams notifications settings", async () => {
		const result = await updateTeamsNotificationChannelSettings(settings);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.set).toHaveBeenCalledWith(settings);
		expect(mocks.where).toHaveBeenCalledWith({ eq: ["teamsOrganizationId", "org-1"] });
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/teams-notifications");
	});

	it("rejects digest time without two digit hour format before updating", async () => {
		const result = await updateSlackNotificationChannelSettings({
			...settings,
			digestTime: "9:30",
		});

		expect(result).toEqual({
			success: false,
			error: "Digest time must use HH:mm format",
		});
		expect(mocks.requireAccess).toHaveBeenCalledTimes(1);
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("rejects unsupported digest timezones before updating", async () => {
		const result = await updateSlackNotificationChannelSettings({
			...settings,
			digestTimezone: "not-a-zone",
		});

		expect(result).toEqual({
			success: false,
			error: "Digest timezone must be a valid timezone",
		});
		expect(mocks.requireAccess).toHaveBeenCalledTimes(1);
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("rejects malformed serialized settings without throwing", async () => {
		const result = await updateSlackNotificationChannelSettings({
			...settings,
			enableApprovals: "yes",
			digestTimezone: 123,
			escalationTimeoutHours: "12",
		} as never);

		expect(result).toEqual({
			success: false,
			error: "Enable approvals must be a boolean",
		});
		expect(mocks.requireAccess).toHaveBeenCalledTimes(1);
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("rejects escalation timeout below one hour before updating", async () => {
		const result = await updateSlackNotificationChannelSettings({
			...settings,
			escalationTimeoutHours: 0,
		});

		expect(result).toEqual({
			success: false,
			error: "Escalation timeout must be at least 1 hour",
		});
		expect(mocks.requireAccess).toHaveBeenCalledTimes(1);
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("rejects digest time outside the 24-hour clock before updating", async () => {
		const result = await updateSlackNotificationChannelSettings({
			...settings,
			digestTime: "24:00",
		});

		expect(result).toEqual({
			success: false,
			error: "Digest time must use HH:mm format",
		});
		expect(mocks.requireAccess).toHaveBeenCalledTimes(1);
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("gets Slack config with Slack team name as display name", async () => {
		mocks.slackFindFirst.mockResolvedValue({
			...settings,
			setupStatus: "active",
			slackTeamName: "Acme Slack",
		});

		const result = await getSlackNotificationChannelConfig();

		expect(result).toEqual({
			success: true,
			data: {
				...settings,
				setupStatus: "active",
				displayName: "Acme Slack",
			},
		});
	});

	it("gets Discord config with application ID as display name", async () => {
		mocks.discordFindFirst.mockResolvedValue({
			...settings,
			setupStatus: "active",
			applicationId: "discord-app-1",
		});

		const result = await getDiscordNotificationChannelConfig();

		expect(result).toEqual({
			success: true,
			data: {
				...settings,
				setupStatus: "active",
				displayName: "discord-app-1",
			},
		});
	});

	it("gets Teams config with tenant name as display name", async () => {
		mocks.teamsFindFirst.mockResolvedValue({
			...settings,
			setupStatus: "active",
			tenantName: "Acme Tenant",
		});

		const result = await getTeamsNotificationChannelConfig();

		expect(result).toEqual({
			success: true,
			data: {
				...settings,
				setupStatus: "active",
				displayName: "Acme Tenant",
			},
		});
	});
});
