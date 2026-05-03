"use server";

import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { discordBotConfig, slackWorkspaceConfig, teamsTenantConfig } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

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

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

function validateSettings(settings: unknown): ActionResult<NotificationChannelSettingsFormValues> {
	if (!settings || typeof settings !== "object") {
		return { success: false, error: "Settings are required" };
	}

	const values = settings as Record<string, unknown>;

	if (typeof values.enableApprovals !== "boolean") {
		return { success: false, error: "Enable approvals must be a boolean" };
	}

	if (typeof values.enableCommands !== "boolean") {
		return { success: false, error: "Enable commands must be a boolean" };
	}

	if (typeof values.enableDailyDigest !== "boolean") {
		return { success: false, error: "Enable daily digest must be a boolean" };
	}

	if (typeof values.enableEscalations !== "boolean") {
		return { success: false, error: "Enable escalations must be a boolean" };
	}

	if (typeof values.digestTime !== "string") {
		return { success: false, error: "Digest time must use HH:mm format" };
	}

	if (typeof values.digestTimezone !== "string") {
		return { success: false, error: "Digest timezone is required" };
	}

	if (typeof values.escalationTimeoutHours !== "number") {
		return { success: false, error: "Escalation timeout must be at least 1 hour" };
	}

	const parsedSettings: NotificationChannelSettingsFormValues = {
		enableApprovals: values.enableApprovals,
		enableCommands: values.enableCommands,
		enableDailyDigest: values.enableDailyDigest,
		enableEscalations: values.enableEscalations,
		digestTime: values.digestTime,
		digestTimezone: values.digestTimezone,
		escalationTimeoutHours: values.escalationTimeoutHours,
	};

	if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(parsedSettings.digestTime)) {
		return { success: false, error: "Digest time must use HH:mm format" };
	}

	if (!parsedSettings.digestTimezone.trim()) {
		return { success: false, error: "Digest timezone is required" };
	}

	if (!DateTime.local().setZone(parsedSettings.digestTimezone).isValid) {
		return { success: false, error: "Digest timezone must be a valid timezone" };
	}

	if (
		!Number.isInteger(parsedSettings.escalationTimeoutHours) ||
		parsedSettings.escalationTimeoutHours < 1
	) {
		return { success: false, error: "Escalation timeout must be at least 1 hour" };
	}

	return { success: true, data: parsedSettings };
}

function mapConfig(
	config:
		| (NotificationChannelSettingsFormValues & {
				setupStatus: string;
				slackTeamName?: string | null;
				applicationId?: string | null;
				tenantName?: string | null;
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

export async function getSlackNotificationChannelConfig(): Promise<
	ActionResult<NotificationChannelConfig | null>
> {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const config = await db.query.slackWorkspaceConfig.findFirst({
		where: eq(slackWorkspaceConfig.organizationId, organizationId),
	});

	return { success: true, data: mapConfig(config, config?.slackTeamName) };
}

export async function getDiscordNotificationChannelConfig(): Promise<
	ActionResult<NotificationChannelConfig | null>
> {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const config = await db.query.discordBotConfig.findFirst({
		where: eq(discordBotConfig.organizationId, organizationId),
	});

	return { success: true, data: mapConfig(config, config?.applicationId) };
}

export async function getTeamsNotificationChannelConfig(): Promise<
	ActionResult<NotificationChannelConfig | null>
> {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const config = await db.query.teamsTenantConfig.findFirst({
		where: eq(teamsTenantConfig.organizationId, organizationId),
	});

	return { success: true, data: mapConfig(config, config?.tenantName) };
}

export async function updateSlackNotificationChannelSettings(
	settings: NotificationChannelSettingsFormValues,
): Promise<ActionResult<undefined>> {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const validation = validateSettings(settings);

	if (!validation.success) {
		return validation;
	}

	await db
		.update(slackWorkspaceConfig)
		.set(validation.data)
		.where(eq(slackWorkspaceConfig.organizationId, organizationId));
	revalidatePath("/settings/slack");

	return { success: true, data: undefined };
}

export async function updateDiscordNotificationChannelSettings(
	settings: NotificationChannelSettingsFormValues,
): Promise<ActionResult<undefined>> {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const validation = validateSettings(settings);

	if (!validation.success) {
		return validation;
	}

	await db
		.update(discordBotConfig)
		.set(validation.data)
		.where(eq(discordBotConfig.organizationId, organizationId));
	revalidatePath("/settings/discord");

	return { success: true, data: undefined };
}

export async function updateTeamsNotificationChannelSettings(
	settings: NotificationChannelSettingsFormValues,
): Promise<ActionResult<undefined>> {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const validation = validateSettings(settings);

	if (!validation.success) {
		return validation;
	}

	await db
		.update(teamsTenantConfig)
		.set(validation.data)
		.where(eq(teamsTenantConfig.organizationId, organizationId));
	revalidatePath("/settings/teams-notifications");

	return { success: true, data: undefined };
}
