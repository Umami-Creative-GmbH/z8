import { NotificationSettings } from "@/components/notifications";
import { requireUser } from "@/lib/auth-helpers";

export default async function NotificationsSettingsPage() {
	await requireUser();

	return (
		<div className="p-6">
			<div className="mx-auto max-w-2xl">
				<div className="mb-6">
					<h1 className="text-2xl font-semibold">Notification Settings</h1>
					<p className="text-muted-foreground">Choose how and when you want to be notified</p>
				</div>
				<NotificationSettings />
			</div>
		</div>
	);
}
