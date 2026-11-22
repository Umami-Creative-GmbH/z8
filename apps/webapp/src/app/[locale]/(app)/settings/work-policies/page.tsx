import { Suspense } from "react";
import { ChangePolicyManagement } from "@/components/settings/change-policy/change-policy-management";
import { WorkPolicyManagement } from "@/components/settings/work-policy/work-policy-management";
import { WorkPolicySettingsTabs } from "@/components/settings/work-policy/work-policy-settings-tabs";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { env } from "@/env";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

async function WorkPoliciesPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		return redirectWithLocale("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}

	// Violation instants are shown on the organization's calendar, not the viewer's.
	const organizationTimezone = await loadOrganizationTimezone(db, organizationId);
	const workPolicyVersioningEnabled = env.WORK_POLICY_VERSIONING_ENABLED === "true";

	return (
		<WorkPolicySettingsTabs
			key={organizationId}
			panels={{
				work: (
					<WorkPolicyManagement
						organizationId={organizationId}
						accessTier={settingsRouteContext.accessTier}
						organizationTimezone={organizationTimezone}
						workPolicyVersioningEnabled={workPolicyVersioningEnabled}
					/>
				),
				changes: (
					<ChangePolicyManagement
						organizationId={organizationId}
						canManage={settingsRouteContext.accessTier === "orgAdmin"}
					/>
				),
			}}
		/>
	);
}

function WorkPoliciesPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex min-w-0 flex-1 flex-col gap-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.workPolicySettings",
				labelDefault: "Loading work policy settings",
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

export default function WorkPoliciesPage() {
	return (
		<Suspense fallback={<WorkPoliciesPageLoading />}>
			<WorkPoliciesPageContent />
		</Suspense>
	);
}
