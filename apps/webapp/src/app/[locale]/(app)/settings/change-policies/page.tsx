import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ChangePolicyManagement } from "@/components/settings/change-policy/change-policy-management";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function ChangePoliciesSettingsPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext) {
		redirect("/settings");
	}

	const { authContext, accessTier } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (accessTier === "member" || !organizationId) {
		redirect("/settings");
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
		<div className="space-y-4">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export default function ChangePoliciesSettingsPage() {
	return (
		<Suspense fallback={<ChangePoliciesSettingsPageLoading />}>
			<ChangePoliciesSettingsPageContent />
		</Suspense>
	);
}
