import { and, eq } from "drizzle-orm";
import { TelegramSettings } from "@/components/settings/telegram-settings";
import { db } from "@/db";
import { telegramBotConfig, telegramUserMapping } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

export async function TelegramPanel() {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();

	const userId = authContext.user.id;

	const [config, userMapping] = await Promise.all([
		db.query.telegramBotConfig.findFirst({
			where: eq(telegramBotConfig.organizationId, organizationId),
		}),
		db.query.telegramUserMapping.findFirst({
			where: and(
				eq(telegramUserMapping.userId, userId),
				eq(telegramUserMapping.organizationId, organizationId),
				eq(telegramUserMapping.isActive, true),
			),
		}),
	]);

	// Map DB config to client-safe shape (exclude sensitive fields like botToken)
	const initialConfig =
		config && config.setupStatus !== "disconnected"
			? {
					botUsername: config.botUsername,
					botDisplayName: config.botDisplayName,
					setupStatus: config.setupStatus,
					webhookRegistered: config.webhookRegistered,
					enableApprovals: config.enableApprovals,
					enableCommands: config.enableCommands,
					enableDailyDigest: config.enableDailyDigest,
					enableEscalations: config.enableEscalations,
					digestTime: config.digestTime,
					digestTimezone: config.digestTimezone,
					escalationTimeoutHours: config.escalationTimeoutHours,
				}
			: null;

	const initialUserLink = userMapping
		? {
				telegramUsername: userMapping.telegramUsername,
				telegramDisplayName: userMapping.telegramDisplayName,
				isActive: userMapping.isActive,
			}
		: null;

	return (
		<TelegramSettings
			initialConfig={initialConfig}
			initialUserLink={initialUserLink}
			organizationId={organizationId}
			userId={userId}
			isAdmin
		/>
	);
}
