import { redirect } from "next/navigation";
import { Suspense } from "react";
import { WorkPolicyManagement } from "@/components/settings/work-policy/work-policy-management";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function WorkPoliciesPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId =
		settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	return (
		<WorkPolicyManagement
			organizationId={organizationId}
			accessTier={settingsRouteContext.accessTier}
		/>
	);
}

function WorkPoliciesPageLoading() {
	return (
		<div className="space-y-4">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export default function WorkPoliciesPage() {
	return (
		<Suspense fallback={<WorkPoliciesPageLoading />}>
			<WorkPoliciesPageContent />
		</Suspense>
	);
}
