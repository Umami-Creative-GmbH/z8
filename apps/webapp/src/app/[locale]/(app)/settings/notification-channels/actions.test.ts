import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	revalidatePath: vi.fn(),
	update: vi.fn(),
	set: vi.fn(),
	where: vi.fn(),
	insert: vi.fn(),
	values: vi.fn(),
	slackFindFirst: vi.fn(),
	discordFindFirst: vi.fn(),
	teamsFindFirst: vi.fn(),
	verifyBotApplication: vi.fn(),
	registerDiscordSlashCommands: vi.fn(),
	getOrgSecret: vi.fn(),
	storeOrgSecret: vi.fn(),
	deleteOrgSecret: vi.fn(),
	getOrganizationChatInstallationsInventory: vi.fn(),
	getProviderChatInstallationInventory: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/env", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/env")>();
	return {
		...actual,
		env: {
			...actual.env,
			APP_URL: "https://app.example.com",
		},
	};
});

vi.mock("@/lib/discord", () => ({
	verifyBotApplication: mocks.verifyBotApplication,
	registerDiscordSlashCommands: mocks.registerDiscordSlashCommands,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/vault", () => ({
	getOrgSecret: mocks.getOrgSecret,
	storeOrgSecret: mocks.storeOrgSecret,
	deleteOrgSecret: mocks.deleteOrgSecret,
}));

vi.mock("@/lib/chat-installations", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-installations")>();
	return {
		...actual,
		getOrganizationChatInstallationsInventory: mocks.getOrganizationChatInstallationsInventory,
		getProviderChatInstallationInventory: mocks.getProviderChatInstallationInventory,
	};
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	const { DatabaseError } = await import("@/lib/effect/errors");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				update: mocks.update,
				insert: mocks.insert,
				query: {
					slackWorkspaceConfig: { findFirst: mocks.slackFindFirst },
					discordBotConfig: { findFirst: mocks.discordFindFirst },
					teamsTenantConfig: { findFirst: mocks.teamsFindFirst },
				},
			},
			query: (name, fn) =>
				Effect.tryPromise({
					try: fn,
					catch: (cause) =>
						new DatabaseError({
							message: `Database error during ${name}`,
							operation: name,
							cause,
						}),
				}),
		}),
	);
});

import { discordBotConfig, slackWorkspaceConfig, teamsTenantConfig } from "@/db/schema";
import {
	connectDiscordBot,
	disconnectDiscordBot,
	getChatInstallationsInventory,
	getDiscordNotificationChannelConfig,
	getProviderChatInstallationInventory,
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

const validDiscordCredentials = {
	botToken: "MTIzNDU2Nzg5MDEyMzQ1Njc4.mock.token",
	applicationId: "123456789012345678",
	publicKey: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
};

describe("notification channel settings actions", () => {
	beforeEach(() => {
		mocks.caller = orgAdmin;
		mocks.revalidatePath.mockReset();
		mocks.update.mockReset();
		mocks.set.mockReset();
		mocks.where.mockReset();
		mocks.insert.mockReset();
		mocks.values.mockReset();
		mocks.slackFindFirst.mockReset();
		mocks.discordFindFirst.mockReset();
		mocks.teamsFindFirst.mockReset();
		mocks.verifyBotApplication.mockReset();
		mocks.registerDiscordSlashCommands.mockReset();
		mocks.getOrgSecret.mockReset();
		mocks.storeOrgSecret.mockReset();
		mocks.deleteOrgSecret.mockReset();
		mocks.getOrganizationChatInstallationsInventory.mockReset();
		mocks.getProviderChatInstallationInventory.mockReset();

		mocks.where.mockResolvedValue(undefined);
		mocks.set.mockReturnValue({ where: mocks.where });
		mocks.update.mockReturnValue({ set: mocks.set });
		mocks.values.mockResolvedValue(undefined);
		mocks.insert.mockReturnValue({ values: mocks.values });
		mocks.verifyBotApplication.mockResolvedValue({
			kind: "ok",
			application: {
				id: validDiscordCredentials.applicationId,
				name: "Z8 Bot",
				verifyKey: validDiscordCredentials.publicKey,
			},
		});
		mocks.registerDiscordSlashCommands.mockResolvedValue(true);
		mocks.getOrgSecret.mockResolvedValue(null);
		mocks.storeOrgSecret.mockResolvedValue(undefined);
		mocks.deleteOrgSecret.mockResolvedValue(undefined);
	});

	it.each([
		["Slack", updateSlackNotificationChannelSettings, slackWorkspaceConfig],
		["Discord", updateDiscordNotificationChannelSettings, discordBotConfig],
		["Teams", updateTeamsNotificationChannelSettings, teamsTenantConfig],
	] as const)(
		"updates %s channel settings of the session's organization",
		async (_name, update, table) => {
			const result = await update(settings);

			expect(result).toEqual({ success: true, data: undefined });
			expect(mocks.update).toHaveBeenCalledWith(table);
			expect(mocks.set).toHaveBeenCalledWith(settings);
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
		["getInventory", () => getChatInstallationsInventory()],
		["getProviderInventory", () => getProviderChatInstallationInventory({ provider: "slack" })],
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

	it("gets Discord config with application ID as display name and interaction URL when active", async () => {
		mocks.discordFindFirst.mockResolvedValue({
			...settings,
			setupStatus: "active",
			applicationId: "discord-app-1",
			webhookSecret: "secret-abc",
		});

		const result = await getDiscordNotificationChannelConfig();

		expect(result).toEqual({
			success: true,
			data: {
				...settings,
				setupStatus: "active",
				displayName: "discord-app-1",
				interactionUrl: "https://app.example.com/api/discord/interactions/secret-abc",
			},
		});
	});

	it("omits interaction URL when Discord is disconnected", async () => {
		mocks.discordFindFirst.mockResolvedValue({
			...settings,
			setupStatus: "disconnected",
			applicationId: "discord-app-1",
			webhookSecret: "secret-abc",
		});

		const result = await getDiscordNotificationChannelConfig();

		expect(result).toEqual({
			success: true,
			data: {
				...settings,
				setupStatus: "disconnected",
				displayName: "discord-app-1",
				interactionUrl: null,
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
			data: { ...settings, setupStatus: "active", displayName: "Acme Tenant" },
		});
	});

	it("reads no config when the integration is not set up", async () => {
		mocks.slackFindFirst.mockResolvedValue(undefined);

		expect(await getSlackNotificationChannelConfig()).toEqual({ success: true, data: null });
	});
});

describe("Discord bot connect and disconnect actions", () => {
	beforeEach(() => {
		mocks.caller = orgAdmin;
		mocks.revalidatePath.mockReset();
		mocks.update.mockReset();
		mocks.set.mockReset();
		mocks.where.mockReset();
		mocks.insert.mockReset();
		mocks.values.mockReset();
		mocks.discordFindFirst.mockReset();
		mocks.verifyBotApplication.mockReset();
		mocks.registerDiscordSlashCommands.mockReset();
		mocks.getOrgSecret.mockReset();
		mocks.storeOrgSecret.mockReset();
		mocks.deleteOrgSecret.mockReset();
		mocks.getOrganizationChatInstallationsInventory.mockReset();
		mocks.getProviderChatInstallationInventory.mockReset();

		mocks.where.mockResolvedValue(undefined);
		mocks.set.mockReturnValue({ where: mocks.where });
		mocks.update.mockReturnValue({ set: mocks.set });
		mocks.values.mockResolvedValue(undefined);
		mocks.insert.mockReturnValue({ values: mocks.values });
		mocks.discordFindFirst.mockResolvedValue(undefined);
		mocks.verifyBotApplication.mockResolvedValue({
			kind: "ok",
			application: {
				id: validDiscordCredentials.applicationId,
				name: "Z8 Bot",
				verifyKey: validDiscordCredentials.publicKey,
			},
		});
		mocks.registerDiscordSlashCommands.mockResolvedValue(true);
		mocks.getOrgSecret.mockResolvedValue(null);
		mocks.storeOrgSecret.mockResolvedValue(undefined);
		mocks.deleteOrgSecret.mockResolvedValue(undefined);
	});

	it.each([
		["a signed-out caller", null, "AuthenticationError"],
		["a pending membership", { ...orgAdmin, membershipRole: null }, "AuthorizationError"],
		[
			"a former employee",
			{ ...orgAdmin, employee: { id: "emp-1", role: "admin" as const, former: true } },
			"AuthorizationError",
		],
		[
			"an org member",
			{
				...orgAdmin,
				membershipRole: "member",
				employee: { id: "emp-1", role: "employee" as const, former: false },
			},
			"AuthorizationError",
		],
		["a scoped manager", scopedManager, "AuthorizationError"],
	] as const)(
		"refuses connecting Discord for %s before calling Discord or storing secrets",
		async (_label, caller, expectedCode) => {
			mocks.caller = caller;

			const result = await connectDiscordBot(validDiscordCredentials);

			expect(result).toMatchObject({ success: false, code: expectedCode });
			expect(mocks.verifyBotApplication).not.toHaveBeenCalled();
			expect(mocks.storeOrgSecret).not.toHaveBeenCalled();
			expect(mocks.insert).not.toHaveBeenCalled();
			expect(mocks.update).not.toHaveBeenCalled();
		},
	);

	it.each([
		["a signed-out caller", null, "AuthenticationError"],
		["a pending membership", { ...orgAdmin, membershipRole: null }, "AuthorizationError"],
		[
			"a former employee",
			{ ...orgAdmin, employee: { id: "emp-1", role: "admin" as const, former: true } },
			"AuthorizationError",
		],
		[
			"an org member",
			{
				...orgAdmin,
				membershipRole: "member",
				employee: { id: "emp-1", role: "employee" as const, former: false },
			},
			"AuthorizationError",
		],
		["a scoped manager", scopedManager, "AuthorizationError"],
	] as const)(
		"refuses disconnecting Discord for %s before touching Vault or DB",
		async (_label, caller, expectedCode) => {
			mocks.caller = caller;

			const result = await disconnectDiscordBot();

			expect(result).toMatchObject({ success: false, code: expectedCode });
			expect(mocks.discordFindFirst).not.toHaveBeenCalled();
			expect(mocks.deleteOrgSecret).not.toHaveBeenCalled();
			expect(mocks.update).not.toHaveBeenCalled();
		},
	);

	it.each([
		["blank bot token", { botToken: "   " }, "Bot token is required"],
		["blank application ID", { applicationId: "   " }, "Application ID is required"],
		[
			"non-numeric application ID",
			{ applicationId: "not-a-snowflake" },
			"Application ID must be a numeric Discord ID",
		],
		["blank public key", { publicKey: "   " }, "Public key is required"],
		[
			"non-hex public key",
			{ publicKey: "not-hex-key" },
			"Public key must be a 64-character hex string",
		],
	])("rejects %s before calling Discord or Vault", async (_label, override, expectedError) => {
		const result = await connectDiscordBot({
			...validDiscordCredentials,
			...override,
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: expectedError,
		});
		expect(mocks.verifyBotApplication).not.toHaveBeenCalled();
		expect(mocks.storeOrgSecret).not.toHaveBeenCalled();
	});

	it("rejects an invalid bot token with refusal code and stores nothing", async () => {
		mocks.verifyBotApplication.mockResolvedValueOnce({ kind: "unauthorized", status: 401 });

		const result = await connectDiscordBot(validDiscordCredentials);

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "invalid_bot_token",
		});
		expect(mocks.storeOrgSecret).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("returns ExternalServiceError when Discord is rate-limited or unavailable", async () => {
		mocks.verifyBotApplication.mockResolvedValueOnce({ kind: "error", status: 503 });

		const result = await connectDiscordBot(validDiscordCredentials);

		expect(result).toEqual({
			success: false,
			code: "ExternalServiceError",
			error: "Failed to connect Discord bot",
		});
		expect(mocks.storeOrgSecret).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
	});

	it("rejects an application ID that does not match the Discord application for the token", async () => {
		mocks.verifyBotApplication.mockResolvedValueOnce({
			kind: "ok",
			application: {
				id: "999999999999999999",
				name: "Other Bot",
				verifyKey: validDiscordCredentials.publicKey,
			},
		});

		const result = await connectDiscordBot(validDiscordCredentials);

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "application_id_mismatch",
		});
		expect(mocks.storeOrgSecret).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
	});

	it("rejects a public key that does not match the Discord application verify key", async () => {
		mocks.verifyBotApplication.mockResolvedValueOnce({
			kind: "ok",
			application: {
				id: validDiscordCredentials.applicationId,
				name: "Z8 Bot",
				verifyKey: "f".repeat(64),
			},
		});

		const result = await connectDiscordBot(validDiscordCredentials);

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "public_key_mismatch",
		});
		expect(mocks.storeOrgSecret).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
	});

	it("matches public keys case-insensitively against Discord verify_key", async () => {
		mocks.verifyBotApplication.mockResolvedValueOnce({
			kind: "ok",
			application: {
				id: validDiscordCredentials.applicationId,
				name: "Z8 Bot",
				verifyKey: validDiscordCredentials.publicKey.toUpperCase(),
			},
		});

		const result = await connectDiscordBot(validDiscordCredentials);

		expect(result.success).toBe(true);
	});

	it("connects a new Discord bot, stores the token in Vault, registers commands, and returns the interaction URL", async () => {
		const result = await connectDiscordBot({
			botToken: `  ${validDiscordCredentials.botToken}  `,
			applicationId: `  ${validDiscordCredentials.applicationId}  `,
			publicKey: `  ${validDiscordCredentials.publicKey}  `,
		});

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data.applicationId).toBe(validDiscordCredentials.applicationId);
		expect(result.data.commandsRegistered).toBe(true);
		expect(result.data.interactionUrl).toMatch(
			/^https:\/\/app\.example\.com\/api\/discord\/interactions\/[0-9a-f]{64}$/,
		);

		expect(mocks.verifyBotApplication).toHaveBeenCalledWith(validDiscordCredentials.botToken);
		expect(mocks.storeOrgSecret).toHaveBeenCalledWith(
			"org-1",
			"discord/bot_token",
			validDiscordCredentials.botToken,
		);
		expect(mocks.insert).toHaveBeenCalledWith(discordBotConfig);
		expect(mocks.values).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				botToken: "vault:managed",
				applicationId: validDiscordCredentials.applicationId,
				publicKey: validDiscordCredentials.publicKey,
				interactionEndpointConfigured: false,
				setupStatus: "active",
				configuredByUserId: "user-admin",
			}),
		);
		expect(mocks.registerDiscordSlashCommands).toHaveBeenCalledWith(
			validDiscordCredentials.botToken,
			validDiscordCredentials.applicationId,
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/notification-channels");
	});

	it("updates an existing Discord bot configuration and resets interactionEndpointConfigured when reconnecting", async () => {
		mocks.discordFindFirst.mockResolvedValueOnce({
			id: "discord-cfg-1",
			organizationId: "org-1",
			setupStatus: "disconnected",
		});

		const result = await connectDiscordBot(validDiscordCredentials);

		expect(result.success).toBe(true);
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.update).toHaveBeenCalledWith(discordBotConfig);
		expect(mocks.set).toHaveBeenCalledWith(
			expect.objectContaining({
				botToken: "vault:managed",
				applicationId: validDiscordCredentials.applicationId,
				publicKey: validDiscordCredentials.publicKey,
				interactionEndpointConfigured: false,
				setupStatus: "active",
				configuredByUserId: "user-admin",
			}),
		);
	});

	it("deletes the stored Vault secret if inserting a new Discord config fails", async () => {
		mocks.values.mockRejectedValueOnce(new Error("DB write failed"));

		const result = await connectDiscordBot(validDiscordCredentials);

		expect(result).toMatchObject({ success: false, code: "DatabaseError" });
		expect(mocks.storeOrgSecret).toHaveBeenCalledWith(
			"org-1",
			"discord/bot_token",
			validDiscordCredentials.botToken,
		);
		expect(mocks.deleteOrgSecret).toHaveBeenCalledWith("org-1", "discord/bot_token");
	});

	it("restores the previous Vault secret if updating an active Discord config fails", async () => {
		mocks.discordFindFirst.mockResolvedValueOnce({
			id: "discord-cfg-1",
			organizationId: "org-1",
			setupStatus: "active",
		});
		mocks.getOrgSecret.mockResolvedValueOnce("previous-working-token");
		mocks.where.mockRejectedValueOnce(new Error("DB update failed"));

		const result = await connectDiscordBot(validDiscordCredentials);

		expect(result).toMatchObject({ success: false, code: "DatabaseError" });
		expect(mocks.storeOrgSecret).toHaveBeenNthCalledWith(
			1,
			"org-1",
			"discord/bot_token",
			validDiscordCredentials.botToken,
		);
		expect(mocks.storeOrgSecret).toHaveBeenNthCalledWith(
			2,
			"org-1",
			"discord/bot_token",
			"previous-working-token",
		);
		expect(mocks.deleteOrgSecret).not.toHaveBeenCalled();
	});

	it.each([
		["returns false", () => mocks.registerDiscordSlashCommands.mockResolvedValueOnce(false)],
		[
			"throws",
			() => mocks.registerDiscordSlashCommands.mockRejectedValueOnce(new Error("Discord 500")),
		],
	])(
		"still connects and reports commandsRegistered=false when slash command registration %s",
		async (_label, setupFailure) => {
			setupFailure();

			const result = await connectDiscordBot(validDiscordCredentials);

			expect(result.success).toBe(true);
			if (!result.success) return;
			expect(result.data.commandsRegistered).toBe(false);
			expect(result.data.interactionUrl).toMatch(
				/^https:\/\/app\.example\.com\/api\/discord\/interactions\/[0-9a-f]{64}$/,
			);
		},
	);

	it("returns ExternalServiceError without leaking internal details when Vault storage fails", async () => {
		mocks.storeOrgSecret.mockRejectedValueOnce(new Error("Vault token expired"));

		const result = await connectDiscordBot(validDiscordCredentials);

		expect(result).toEqual({
			success: false,
			code: "ExternalServiceError",
			error: "Failed to connect Discord bot",
		});
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("does not delete the Vault secret when marking the Discord config disconnected fails", async () => {
		mocks.discordFindFirst.mockResolvedValueOnce({
			id: "discord-cfg-1",
			organizationId: "org-1",
			setupStatus: "active",
		});
		mocks.where.mockRejectedValueOnce(new Error("DB unavailable"));

		const result = await disconnectDiscordBot();

		expect(result).toMatchObject({ success: false, code: "DatabaseError" });
		expect(mocks.deleteOrgSecret).not.toHaveBeenCalled();
	});

	it("marks the config disconnected before attempting Vault deletion when Vault deletion fails", async () => {
		mocks.discordFindFirst.mockResolvedValueOnce({
			id: "discord-cfg-1",
			organizationId: "org-1",
			setupStatus: "active",
		});
		mocks.deleteOrgSecret.mockRejectedValueOnce(new Error("Vault unavailable"));

		const result = await disconnectDiscordBot();

		expect(result).toEqual({
			success: false,
			code: "ExternalServiceError",
			error: "Failed to disconnect Discord bot",
		});
		expect(mocks.update).toHaveBeenCalledWith(discordBotConfig);
		expect(mocks.set).toHaveBeenCalledWith({
			setupStatus: "disconnected",
			interactionEndpointConfigured: false,
		});
	});

	it("disconnects Discord by marking the config disconnected before deleting the Vault secret", async () => {
		const order: string[] = [];
		mocks.discordFindFirst.mockResolvedValueOnce({
			id: "discord-cfg-1",
			organizationId: "org-1",
			setupStatus: "active",
		});
		mocks.where.mockImplementationOnce(async () => {
			order.push("db-update");
		});
		mocks.deleteOrgSecret.mockImplementationOnce(async () => {
			order.push("vault-delete");
		});

		const result = await disconnectDiscordBot();

		expect(result).toEqual({ success: true, data: undefined });
		expect(order).toEqual(["db-update", "vault-delete"]);
		expect(mocks.deleteOrgSecret).toHaveBeenCalledWith("org-1", "discord/bot_token");
		expect(mocks.update).toHaveBeenCalledWith(discordBotConfig);
		expect(mocks.set).toHaveBeenCalledWith({
			setupStatus: "disconnected",
			interactionEndpointConfigured: false,
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/notification-channels");
	});

	it("succeeds without touching Vault or DB when disconnecting with no existing config", async () => {
		mocks.discordFindFirst.mockResolvedValueOnce(undefined);

		const result = await disconnectDiscordBot();

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.deleteOrgSecret).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/notification-channels");
	});
});

describe("chat installations inventory actions", () => {
	beforeEach(() => {
		mocks.caller = orgAdmin;
		mocks.getOrganizationChatInstallationsInventory.mockReset();
		mocks.getProviderChatInstallationInventory.mockReset();
	});

	it.each([
		["signed-out caller", null, "AuthenticationError"],
		["pending membership", { ...orgAdmin, membershipRole: null }, "AuthorizationError"],
		[
			"former employee",
			{ ...orgAdmin, employee: { id: "emp-1", role: "admin" as const, former: true } },
			"AuthorizationError",
		],
		[
			"org member",
			{
				...orgAdmin,
				membershipRole: "member",
				employee: { id: "emp-1", role: "employee" as const, former: false },
			},
			"AuthorizationError",
		],
		["scoped manager", scopedManager, "AuthorizationError"],
	] as const)(
		"refuses reading chat installations inventory for %s before touching the store",
		async (_label, caller, expectedCode) => {
			mocks.caller = caller;

			const allResult = await getChatInstallationsInventory();
			const singleResult = await getProviderChatInstallationInventory({ provider: "teams" });

			expect(allResult).toMatchObject({ success: false, code: expectedCode });
			expect(singleResult).toMatchObject({ success: false, code: expectedCode });
			expect(mocks.getOrganizationChatInstallationsInventory).not.toHaveBeenCalled();
			expect(mocks.getProviderChatInstallationInventory).not.toHaveBeenCalled();
		},
	);

	it("returns the active organization's inventory for an org admin", async () => {
		const fakeInventory = {
			organizationId: "org-1",
			generatedAt: "2026-11-26T10:00:00.000Z",
			providers: {},
		};
		mocks.getOrganizationChatInstallationsInventory.mockResolvedValueOnce(fakeInventory);

		const result = await getChatInstallationsInventory();

		expect(result).toEqual({ success: true, data: fakeInventory });
		expect(mocks.getOrganizationChatInstallationsInventory).toHaveBeenCalledWith(
			"org-1",
			expect.objectContaining({ db: expect.anything() }),
		);
	});

	it("returns a single provider inventory and rejects unknown provider names", async () => {
		const fakeProvider = { provider: "teams", connectionState: "connected" };
		mocks.getProviderChatInstallationInventory.mockResolvedValueOnce(fakeProvider);

		const ok = await getProviderChatInstallationInventory({ provider: "teams" });
		expect(ok).toEqual({ success: true, data: fakeProvider });
		expect(mocks.getProviderChatInstallationInventory).toHaveBeenCalledWith(
			"org-1",
			"teams",
			expect.objectContaining({ db: expect.anything() }),
		);

		const invalid = await getProviderChatInstallationInventory({
			provider: "irc" as never,
		});
		expect(invalid).toMatchObject({ success: false, code: "ValidationError" });
	});
});
