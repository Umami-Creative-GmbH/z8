import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	revalidatePath: vi.fn(),
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

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				update: mocks.update,
				query: {
					slackWorkspaceConfig: { findFirst: mocks.slackFindFirst },
					discordBotConfig: { findFirst: mocks.discordFindFirst },
					teamsTenantConfig: { findFirst: mocks.teamsFindFirst },
				},
			},
		}),
	);
});

import { discordBotConfig, slackWorkspaceConfig, teamsTenantConfig } from "@/db/schema";
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

const orgAdmin: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};

/** A scoped manager: one level below the org admin these actions require. */
const scopedManager: StubCaller = {
	userId: "user-manager",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-manager", role: "manager", former: false },
};

describe("notification channel settings actions", () => {
	beforeEach(() => {
		mocks.caller = orgAdmin;
		mocks.revalidatePath.mockReset();
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

	it.each([
		["Slack", updateSlackNotificationChannelSettings, slackWorkspaceConfig, "/settings/slack"],
		["Discord", updateDiscordNotificationChannelSettings, discordBotConfig, "/settings/discord"],
		[
			"Teams",
			updateTeamsNotificationChannelSettings,
			teamsTenantConfig,
			"/settings/teams-notifications",
		],
	] as const)(
		"updates %s channel settings of the session's organization",
		async (_name, update, table, path) => {
			const result = await update(settings);

			expect(result).toEqual({ success: true, data: undefined });
			expect(mocks.update).toHaveBeenCalledWith(table);
			expect(mocks.set).toHaveBeenCalledWith(settings);
			expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
			expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/notification-channels");
		},
	);

	it.each([
		["updateSlack", () => updateSlackNotificationChannelSettings(settings)],
		["updateDiscord", () => updateDiscordNotificationChannelSettings(settings)],
		["updateTeams", () => updateTeamsNotificationChannelSettings(settings)],
		["getSlack", () => getSlackNotificationChannelConfig()],
		["getDiscord", () => getDiscordNotificationChannelConfig()],
		["getTeams", () => getTeamsNotificationChannelConfig()],
	] as const)("refuses a scoped manager (%s) without a redirect", async (_name, call) => {
		mocks.caller = scopedManager;

		const result = await call();

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.slackFindFirst).not.toHaveBeenCalled();
		expect(mocks.discordFindFirst).not.toHaveBeenCalled();
		expect(mocks.teamsFindFirst).not.toHaveBeenCalled();
	});

	it.each([
		[
			"digest time without a two digit hour",
			{ digestTime: "9:30" },
			"Digest time must use HH:mm format",
		],
		[
			"an unsupported digest timezone",
			{ digestTimezone: "not-a-zone" },
			"Digest timezone must be a valid timezone",
		],
		[
			"a fixed-offset digest timezone",
			{ digestTimezone: "+05:45" },
			"Digest timezone must be a valid timezone",
		],
		[
			"malformed serialized settings",
			{ enableApprovals: "yes", digestTimezone: 123, escalationTimeoutHours: "12" },
			"Enable approvals must be a boolean",
		],
		[
			"an escalation timeout below one hour",
			{ escalationTimeoutHours: 0 },
			"Escalation timeout must be at least 1 hour",
		],
		[
			"digest time outside the 24-hour clock",
			{ digestTime: "24:00" },
			"Digest time must use HH:mm format",
		],
	])("rejects %s before updating", async (_name, change, error) => {
		const result = await updateSlackNotificationChannelSettings({
			...settings,
			...change,
		} as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError", error });
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
			data: { ...settings, setupStatus: "active", displayName: "Acme Slack" },
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
			data: { ...settings, setupStatus: "active", displayName: "discord-app-1" },
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
			data: { ...settings, setupStatus: "active", displayName: "Acme Tenant" },
		});
	});

	it("reads no config when the integration is not set up", async () => {
		mocks.slackFindFirst.mockResolvedValue(undefined);

		expect(await getSlackNotificationChannelConfig()).toEqual({ success: true, data: null });
	});
});
