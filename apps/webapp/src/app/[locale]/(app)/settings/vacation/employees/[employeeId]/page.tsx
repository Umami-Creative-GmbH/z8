import { Suspense } from "react";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { EmployeeAllowanceEditPageClient } from "./employee-allowance-edit-page-client";

async function GuardedEmployeeAllowanceContent({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	return (
		<EmployeeAllowanceEditPageClient
			params={params}
			organizationId={organizationId}
		/>
	);
}

export default function EmployeeAllowanceEditPage({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	return (
		<Suspense fallback={<SettingsContentLoading />}>
			<GuardedEmployeeAllowanceContent params={params} />
		</Suspense>
	);
}
