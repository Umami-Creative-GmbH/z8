import { Suspense } from "react";
import { ContractsHubClient } from "@/components/settings/contracts/contracts-hub-client";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { env } from "@/env";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

async function ContractsPageContent() {
	const caller = await getCurrentSettingsAccess();

	// Org admins only: scoped managers cannot access org/team contract defaults, templates, or bulk operations.
	if (!caller?.settingsAccess || !meetsSettingsAccess(caller.settingsAccess, "orgAdmin")) {
		return redirectWithLocale("/settings");
	}

	const { organizationId } = caller;

	const organizationTimezone = await loadOrganizationTimezone(db, organizationId);
	const workPolicyVersioningEnabled = env.WORK_POLICY_VERSIONING_ENABLED === "true";

	return (
		<ContractsHubClient
			key={organizationId}
			organizationId={organizationId}
			organizationTimezone={organizationTimezone}
			workPolicyVersioningEnabled={workPolicyVersioningEnabled}
		/>
	);
}

function ContractsPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex min-w-0 flex-1 flex-col gap-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.contractsSettings",
				labelDefault: "Loading contracts settings",
			}}
		>
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" aria-hidden="true" />
				<Skeleton className="h-4 w-full max-w-xl" aria-hidden="true" />
			</div>
			<Skeleton className="h-9 w-96 max-w-full" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function ContractsSettingsPage() {
	return (
		<Suspense fallback={<ContractsPageLoading />}>
			<ContractsPageContent />
		</Suspense>
	);
}
