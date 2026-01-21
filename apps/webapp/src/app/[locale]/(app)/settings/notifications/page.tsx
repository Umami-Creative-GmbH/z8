import { NotificationSettings } from "@/components/notifications";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function NotificationsSettingsPage() {
	const [, t] = await Promise.all([requireUser(), getTranslate()]);

	return (
		<div className="p-6">
			<div className="mx-auto max-w-2xl">
				<div className="mb-6">
					<h1 className="text-2xl font-semibold">{t("settings.notifications.title", "Notification Settings")}</h1>
					<p className="text-muted-foreground">{t("settings.notifications.description", "Choose how and when you want to be notified")}</p>
				</div>
				<NotificationSettings />
			</div>
		</div>
	);
}
