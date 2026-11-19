import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function RedirectContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/audit-export?tab=activity");
}

/** This route redirects to Audit; load in the settings page frame. */
function AuditLogPageLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "settings.loading",
				labelDefault: "Loading settings",
			}}
		/>
	);
}

export default function AuditLogPage() {
	return (
		<Suspense fallback={<AuditLogPageLoading />}>
			<RedirectContent />
		</Suspense>
	);
}
