import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function PermissionsPageContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/roles?tab=team-permissions");
}

/** This route redirects to Custom Roles (Team Permissions tab); load in the settings page frame. */
function PermissionsPageLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "settings.loading",
				labelDefault: "Loading settings",
			}}
		/>
	);
}

export default function PermissionsPage() {
	return (
		<Suspense fallback={<PermissionsPageLoading />}>
			<PermissionsPageContent />
		</Suspense>
	);
}
