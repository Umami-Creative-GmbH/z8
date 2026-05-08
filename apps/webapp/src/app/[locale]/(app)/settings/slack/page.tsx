import {
	getSlackNotificationChannelConfig,
	updateSlackNotificationChannelSettings,
} from "@/app/[locale]/(app)/settings/notification-channels/actions";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function SlackSettingsPage() {
	const [, t] = await Promise.all([requireOrgAdminSettingsAccess(), getTranslate()]);
	const configResult = await getSlackNotificationChannelConfig();
	const description = t(
		"settings.notifications.slack.description",
		"Configure Slack notifications for your organization.",
	);

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">Slack</h1>
					<p className="text-muted-foreground">{description}</p>
				</div>

				<NotificationChannelSettings
					channelName="Slack"
					description={description}
					config={configResult.success ? configResult.data : null}
					updateAction={updateSlackNotificationChannelSettings}
				/>
			</div>
		</div>
	);
}
