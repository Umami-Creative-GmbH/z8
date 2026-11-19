import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function EmailTemplatesSettingsPageContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/enterprise/email?tab=templates");
}
/** This route redirects to the Email settings page; load in its frame. */
function EmailTemplatesSettingsPageLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "settings.loading",
				labelDefault: "Loading settings",
			}}
		/>
	);
}

export default function EmailTemplatesSettingsPage() {
	return (
		<Suspense fallback={<EmailTemplatesSettingsPageLoading />}>
			<EmailTemplatesSettingsPageContent />
		</Suspense>
	);
}
