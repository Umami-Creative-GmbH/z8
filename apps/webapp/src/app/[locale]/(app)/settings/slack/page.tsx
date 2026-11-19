import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function RedirectContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/notification-channels?tab=slack");
}

/** This route redirects to Chat Integrations; load in the settings page frame. */
function LegacyChatSettingsLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "settings.loading",
				labelDefault: "Loading settings",
			}}
		/>
	);
}

export default function LegacyChatSettingsPage() {
	return (
		<Suspense fallback={<LegacyChatSettingsLoading />}>
			<RedirectContent />
		</Suspense>
	);
}
