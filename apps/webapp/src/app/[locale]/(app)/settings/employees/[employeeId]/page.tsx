import { redirect } from "next/navigation";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { getEmployee } from "../actions";
import { getCurrentApprovedMembership } from "../current-approved-membership";
import { EmployeeDetailPageClient } from "./employee-detail-page-client";

export default async function EmployeeDetailPage({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	const [settingsRouteContext, { employeeId }] = await Promise.all([
		getCurrentSettingsRouteContext(),
		params,
	]);

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}
	const organizationId =
		settingsRouteContext.authContext.session.activeOrganizationId;
	if (!organizationId) {
		redirect("/settings");
	}
	const currentUserId = settingsRouteContext.authContext.user.id;
	const currentMember = await getCurrentApprovedMembership({
		userId: currentUserId,
		organizationId,
	});

	if (!currentMember) {
		redirect("/settings");
	}

	const employeeResult = await getEmployee(employeeId);

	if (!employeeResult.success) {
		redirect("/settings/employees");
	}

	return (
		<EmployeeDetailPageClient
			params={Promise.resolve({ employeeId })}
			accessTier={settingsRouteContext.accessTier}
			currentUserId={currentUserId}
			currentMemberRole={currentMember.role}
		/>
	);
}
