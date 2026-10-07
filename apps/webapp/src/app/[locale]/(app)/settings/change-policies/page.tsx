import { Suspense } from "react";
import { ChangePolicyManagement } from "@/components/settings/change-policy/change-policy-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function ChangePoliciesSettingsPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext) {
		return redirectWithLocale("/settings");
	}

	const { authContext, accessTier } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (accessTier === "member" || !organizationId) {
		return redirectWithLocale("/settings");
	}

	return (
		<ChangePolicyManagement
			organizationId={organizationId}
			canManage={accessTier === "orgAdmin"}
		/>
	);
}

function ChangePoliciesSettingsPageLoading() {
	return (
		<LoadingRegion
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.changePolicySettings",
				labelDefault: "Loading change policy settings",
			}}
		>
			<Skeleton className="h-8 w-48" aria-hidden="true" />
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
