import { Suspense } from "react";
import { CustomRolesManagement } from "@/components/settings/custom-roles/custom-roles-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

async function CustomRolesSettingsPageContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	return <CustomRolesManagement organizationId={organizationId} />;
}

function CustomRolesSettingsPageLoading() {
	return (
		<LoadingRegion
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.customRoleSettings",
				labelDefault: "Loading custom role settings",
			}}
		>
			<Skeleton className="h-8 w-48" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function CustomRolesSettingsPage() {
	return (
		<Suspense fallback={<CustomRolesSettingsPageLoading />}>
			<CustomRolesSettingsPageContent />
		</Suspense>
	);
}
