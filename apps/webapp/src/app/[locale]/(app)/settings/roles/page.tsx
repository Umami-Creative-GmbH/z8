import { Suspense } from "react";
import { CustomRolesManagement } from "@/components/settings/custom-roles/custom-roles-management";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

async function CustomRolesSettingsPageContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	return <CustomRolesManagement organizationId={organizationId} />;
}

function CustomRolesSettingsPageLoading() {
	return (
		<div className="space-y-4">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export default function CustomRolesSettingsPage() {
	return (
		<Suspense fallback={<CustomRolesSettingsPageLoading />}>
			<CustomRolesSettingsPageContent />
		</Suspense>
	);
}
