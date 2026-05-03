import {
	getDiscordNotificationChannelConfig,
	updateDiscordNotificationChannelSettings,
} from "@/app/[locale]/(app)/settings/notification-channels/actions";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

export default async function DiscordSettingsPage() {
	await requireOrgAdminSettingsAccess();
	const configResult = await getDiscordNotificationChannelConfig();

	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">Discord</h1>
					<p className="text-muted-foreground">
						Configure Discord notifications for your organization.
					</p>
				</div>

				<NotificationChannelSettings
					channelName="Discord"
					description="Configure Discord notifications for your organization."
					config={configResult.success ? configResult.data : null}
					updateAction={updateDiscordNotificationChannelSettings}
				/>
			</div>
		</div>
	);
}
