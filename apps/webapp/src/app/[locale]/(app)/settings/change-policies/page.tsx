import { Suspense } from "react";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";

async function ChangePoliciesSettingsPageContent() {
	const caller = await getCurrentSettingsAccess();

	if (!caller?.settingsAccess || !meetsSettingsAccess(caller.settingsAccess, "scopedManager")) {
		return redirectWithLocale("/settings");
	}

	return redirectWithLocale("/settings/work-policies?tab=changes");
}

function ChangePoliciesSettingsPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex min-w-0 flex-1 flex-col gap-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.changePolicySettings",
				labelDefault: "Loading change policy settings",
			}}
		>
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" aria-hidden="true" />
				<Skeleton className="h-4 w-full max-w-xl" aria-hidden="true" />
			</div>
			<Skeleton className="h-9 w-64 max-w-full" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function ChangePoliciesSettingsPage() {
	return (
		<Suspense fallback={<ChangePoliciesSettingsPageLoading />}>
			<ChangePoliciesSettingsPageContent />
		</Suspense>
	);
}
