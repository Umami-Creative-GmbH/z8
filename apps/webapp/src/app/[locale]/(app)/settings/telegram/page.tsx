import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function TelegramSettingsContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/notification-channels?tab=telegram");
}
/** This route redirects to Chat Integrations; load in that page's frame. */
function TelegramSettingsLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "settings.loading",
				labelDefault: "Loading settings",
			}}
		/>
	);
}

export default function TelegramSettingsPage() {
	return (
		<Suspense fallback={<TelegramSettingsLoading />}>
			<TelegramSettingsContent />
		</Suspense>
	);
}
