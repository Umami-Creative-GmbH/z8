import {
	getSlackNotificationChannelConfig,
	updateSlackNotificationChannelSettings,
} from "@/app/[locale]/(app)/settings/notification-channels/actions";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

export default async function SlackSettingsPage() {
	await requireOrgAdminSettingsAccess();
	const configResult = await getSlackNotificationChannelConfig();

	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">Slack</h1>
					<p className="text-muted-foreground">
						Configure Slack notifications for your organization.
					</p>
				</div>

				<NotificationChannelSettings
					channelName="Slack"
					description="Configure Slack notifications for your organization."
					config={configResult.success ? configResult.data : null}
					updateAction={updateSlackNotificationChannelSettings}
				/>
			</div>
		</div>
	);
}
