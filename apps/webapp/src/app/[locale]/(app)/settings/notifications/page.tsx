import { NotificationSettings } from "@/components/notifications";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function NotificationsSettingsPage() {
	const [, t] = await Promise.all([requireUser(), getTranslate()]);

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<PageHeader
					title={t("settings.notifications.title", "Notification Settings")}
					description={t(
						"settings.notifications.description",
						"Choose how and when you want to be notified",
					)}
				/>
				<NotificationSettings />
			</div>
		</div>
	);
}
