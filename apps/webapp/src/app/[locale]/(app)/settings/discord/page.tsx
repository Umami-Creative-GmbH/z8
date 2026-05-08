import {
	getDiscordNotificationChannelConfig,
	updateDiscordNotificationChannelSettings,
} from "@/app/[locale]/(app)/settings/notification-channels/actions";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function DiscordSettingsPage() {
	const [, t] = await Promise.all([requireOrgAdminSettingsAccess(), getTranslate()]);
	const configResult = await getDiscordNotificationChannelConfig();
	const description = t(
		"settings.notifications.discord.description",
		"Configure Discord notifications for your organization.",
	);

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">Discord</h1>
					<p className="text-muted-foreground">{description}</p>
				</div>

				<NotificationChannelSettings
					channelName="Discord"
					description={description}
					config={configResult.success ? configResult.data : null}
					updateAction={updateDiscordNotificationChannelSettings}
				/>
			</div>
		</div>
	);
}
