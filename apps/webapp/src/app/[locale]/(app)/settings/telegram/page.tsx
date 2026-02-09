import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { TelegramSettings } from "@/components/settings/telegram-settings";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { telegramBotConfig, telegramUserMapping } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function TelegramSettingsPage() {
	await connection();

	const [authContext, t] = await Promise.all([requireUser(), getTranslate()]);

	const organizationId = authContext.session.activeOrganizationId;
	if (!organizationId) {
		redirect("/");
	}

	const userId = authContext.user.id;

	// Parallelize member check, config fetch, and user link fetch
	const [memberRecord, config, userMapping] = await Promise.all([
		db.query.member.findFirst({
			where: and(
				eq(authSchema.member.userId, userId),
				eq(authSchema.member.organizationId, organizationId),
			),
		}),
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

	if (!memberRecord) {
		redirect("/settings");
	}

	const isAdmin = memberRecord.role === "owner" || memberRecord.role === "admin";

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
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">{t("settings.telegram.title", "Telegram")}</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.telegram.description",
							"Configure Telegram bot integration for notifications and commands",
						)}
					</p>
				</div>

				<TelegramSettings
					initialConfig={initialConfig}
					initialUserLink={initialUserLink}
					organizationId={organizationId}
					userId={userId}
					isAdmin={isAdmin}
				/>
			</div>
		</div>
	);
}
