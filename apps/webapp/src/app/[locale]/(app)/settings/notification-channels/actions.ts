"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { discordBotConfig, slackWorkspaceConfig, teamsTenantConfig } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";

export interface NotificationChannelSettingsFormValues {
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}

export interface NotificationChannelConfig {
	setupStatus: string;
	displayName: string | null;
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}

const notificationChannelSettingsSchema = z.object(
	{
		enableApprovals: z.boolean({ error: "Enable approvals must be a boolean" }),
		enableCommands: z.boolean({ error: "Enable commands must be a boolean" }),
		enableDailyDigest: z.boolean({ error: "Enable daily digest must be a boolean" }),
		enableEscalations: z.boolean({ error: "Enable escalations must be a boolean" }),
		digestTime: z
			.string({ error: "Digest time must use HH:mm format" })
			.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Digest time must use HH:mm format"),
		digestTimezone: z
			.string({ error: "Digest timezone is required" })
			.trim()
			.min(1, "Digest timezone is required")
			.refine(isValidIanaTimeZone, "Digest timezone must be a valid timezone"),
		escalationTimeoutHours: z
			.number({ error: "Escalation timeout must be at least 1 hour" })
			.int("Escalation timeout must be at least 1 hour")
			.min(1, "Escalation timeout must be at least 1 hour"),
	},
	"Settings are required",
) satisfies z.ZodType<NotificationChannelSettingsFormValues>;

function mapConfig(
	config:
		| (NotificationChannelSettingsFormValues & {
				setupStatus: string;
		  })
		| undefined,
	displayName: string | null | undefined,
): NotificationChannelConfig | null {
	if (!config) {
		return null;
	}

	return {
		setupStatus: config.setupStatus,
		displayName: displayName ?? null,
		enableApprovals: config.enableApprovals,
		enableCommands: config.enableCommands,
		enableDailyDigest: config.enableDailyDigest,
		enableEscalations: config.enableEscalations,
		digestTime: config.digestTime,
		digestTimezone: config.digestTimezone,
		escalationTimeoutHours: config.escalationTimeoutHours,
	};
}

export const getSlackNotificationChannelConfig = organizationAction(
	{ name: "notificationChannels.getSlackConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const config = yield* dbService.query("notificationChannels.getSlackConfig", () =>
				dbService.db.query.slackWorkspaceConfig.findFirst({
					where: eq(slackWorkspaceConfig.organizationId, organizationId),
				}),
			);
			return mapConfig(config, config?.slackTeamName);
		}),
);

export const getDiscordNotificationChannelConfig = organizationAction(
	{ name: "notificationChannels.getDiscordConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const config = yield* dbService.query("notificationChannels.getDiscordConfig", () =>
				dbService.db.query.discordBotConfig.findFirst({
					where: eq(discordBotConfig.organizationId, organizationId),
				}),
			);
			return mapConfig(config, config?.applicationId);
		}),
);

export const getTeamsNotificationChannelConfig = organizationAction(
	{ name: "notificationChannels.getTeamsConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const config = yield* dbService.query("notificationChannels.getTeamsConfig", () =>
				dbService.db.query.teamsTenantConfig.findFirst({
					where: eq(teamsTenantConfig.organizationId, organizationId),
				}),
			);
			return mapConfig(config, config?.tenantName);
		}),
);

export const updateSlackNotificationChannelSettings = organizationAction(
	{
		name: "notificationChannels.updateSlackSettings",
		requires: "orgAdmin",
		schema: notificationChannelSettingsSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("notificationChannels.updateSlackSettings", () =>
				dbService.db
					.update(slackWorkspaceConfig)
					.set(input)
					.where(eq(slackWorkspaceConfig.organizationId, organizationId)),
			);
			revalidatePath("/settings/slack");
			revalidatePath("/settings/notification-channels");
			return undefined;
		}),
);

export const updateDiscordNotificationChannelSettings = organizationAction(
	{
		name: "notificationChannels.updateDiscordSettings",
		requires: "orgAdmin",
		schema: notificationChannelSettingsSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("notificationChannels.updateDiscordSettings", () =>
				dbService.db
					.update(discordBotConfig)
					.set(input)
					.where(eq(discordBotConfig.organizationId, organizationId)),
			);
			revalidatePath("/settings/discord");
			revalidatePath("/settings/notification-channels");
			return undefined;
		}),
);

export const updateTeamsNotificationChannelSettings = organizationAction(
	{
		name: "notificationChannels.updateTeamsSettings",
		requires: "orgAdmin",
		schema: notificationChannelSettingsSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("notificationChannels.updateTeamsSettings", () =>
				dbService.db
					.update(teamsTenantConfig)
					.set(input)
					.where(eq(teamsTenantConfig.organizationId, organizationId)),
			);
			revalidatePath("/settings/teams-notifications");
			revalidatePath("/settings/notification-channels");
			return undefined;
		}),
);
