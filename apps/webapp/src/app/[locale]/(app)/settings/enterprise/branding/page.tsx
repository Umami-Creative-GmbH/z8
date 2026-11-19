import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function RedirectContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/enterprise/domains?tab=branding");
}

/** This route redirects to Domain & Branding; load in the settings page frame. */
function BrandingPageLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "settings.loading",
				labelDefault: "Loading settings",
			}}
		/>
	);
}

export default function BrandingPage() {
	return (
		<Suspense fallback={<BrandingPageLoading />}>
			<RedirectContent />
		</Suspense>
	);
}
