import {
	getTeamsNotificationChannelConfig,
	updateTeamsNotificationChannelSettings,
} from "@/app/[locale]/(app)/settings/notification-channels/actions";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

export default async function TeamsNotificationsSettingsPage() {
	await requireOrgAdminSettingsAccess();
	const configResult = await getTeamsNotificationChannelConfig();

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">Microsoft Teams</h1>
					<p className="text-muted-foreground">
						Configure Microsoft Teams notifications for your organization.
					</p>
				</div>

				<NotificationChannelSettings
					channelName="Microsoft Teams"
					description="Configure Microsoft Teams notifications for your organization."
					config={configResult.success ? configResult.data : null}
					updateAction={updateTeamsNotificationChannelSettings}
				/>
			</div>
		</div>
	);
}
