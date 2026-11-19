import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function RedirectContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/enterprise/identity-setup?tab=sso");
}

/** This route redirects to Identity & Access; load in the settings page frame. */
function SSOProvidersPageLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "settings.loading",
				labelDefault: "Loading settings",
			}}
		/>
	);
}

export default function SSOProvidersPage() {
	return (
		<Suspense fallback={<SSOProvidersPageLoading />}>
			<RedirectContent />
		</Suspense>
	);
}
