import { IconCalendar } from "@tabler/icons-react";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { VacationManagement } from "@/components/settings/vacation/vacation-management";
import { VacationPoliciesTable } from "@/components/settings/vacation/vacation-policies-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ensureDefaultAbsenceCategoriesForOrganization } from "@/lib/absences/default-absence-categories";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function VacationSettingsContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	const canManagePolicies = settingsRouteContext.accessTier === "orgAdmin";

	if (canManagePolicies) {
		await ensureDefaultAbsenceCategoriesForOrganization(organizationId);
	}

	const allowedAssignmentTypes = canManagePolicies
		? (["team", "employee"] as const)
		: (["employee"] as const);

	return (
		<VacationManagement
			organizationId={organizationId}
			allowedAssignmentTypes={allowedAssignmentTypes}
			canManageCategories={canManagePolicies}
		>
			<div className="grid gap-4">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconCalendar className="size-5" />
							Vacation Policies
						</CardTitle>
						<CardDescription>
							Create different policies for various teams or employee groups
						</CardDescription>
					</CardHeader>
					<CardContent>
						<VacationPoliciesTable
							organizationId={organizationId}
							canManagePolicies={canManagePolicies}
						/>
					</CardContent>
				</Card>
			</div>
		</VacationManagement>
	);
}

function VacationSettingsLoading() {
	return <SettingsPageSkeleton variant="list" label="Loading vacation settings" />;
}

export default function VacationSettingsPage() {
	return (
		<Suspense fallback={<VacationSettingsLoading />}>
			<VacationSettingsContent />
		</Suspense>
	);
}
