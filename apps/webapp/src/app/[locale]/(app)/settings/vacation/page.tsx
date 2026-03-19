import { IconCalendar } from "@tabler/icons-react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { VacationManagement } from "@/components/settings/vacation-management";
import { VacationPoliciesTable } from "@/components/settings/vacation-policies-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function VacationSettingsContent() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	const canManagePolicies = settingsRouteContext.accessTier === "orgAdmin";
	const allowedAssignmentTypes = canManagePolicies ? (["team", "employee"] as const) : (["employee"] as const);

	return (
		<VacationManagement
			organizationId={organizationId}
			allowedAssignmentTypes={allowedAssignmentTypes}
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
	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="space-y-2">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-4 w-96" />
			</div>
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-4 w-96" />
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-24 w-full" />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export default function VacationSettingsPage() {
	return (
		<Suspense fallback={<VacationSettingsLoading />}>
			<VacationSettingsContent />
		</Suspense>
	);
}
