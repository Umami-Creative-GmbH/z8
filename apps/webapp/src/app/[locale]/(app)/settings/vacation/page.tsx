import { IconCalendar } from "@tabler/icons-react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LegalEntitySelector } from "@/components/settings/legal-entities/legal-entity-selector";
import { VacationManagement } from "@/components/settings/vacation-management";
import { VacationPoliciesTable } from "@/components/settings/vacation-policies-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext, getSettingsAccessInputForUser } from "@/lib/auth-helpers";
import {
	getLegalEntitySelectionContext,
	shouldShowLegalEntitySelector,
} from "@/lib/legal-entities/access";

type LegalEntitySearchParams = {
	legalEntityId?: string;
};

async function VacationSettingsContent({
	searchParams,
}: {
	searchParams?: Promise<LegalEntitySearchParams>;
}) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const [settingsRouteContext, resolvedSearchParams] = await Promise.all([
		getCurrentSettingsRouteContext(),
		searchParams ?? Promise.resolve({} as LegalEntitySearchParams),
	]);

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	const accessTier = settingsRouteContext.accessTier;
	const canManagePolicies = accessTier === "orgAdmin" || accessTier === "entityAdmin";
	const allowedAssignmentTypes = canManagePolicies
		? (["team", "employee"] as const)
		: (["employee"] as const);
	const accessInput = await getSettingsAccessInputForUser(
		settingsRouteContext.authContext.user.id,
		organizationId,
	);
	const legalEntityAccessScope = {
		isOrgAdmin: canManagePolicies,
		allowedLegalEntityIds: accessInput.legalEntityAdminIds ?? [],
	};
	const legalEntitySelectionContext = shouldShowLegalEntitySelector(legalEntityAccessScope)
		? await getLegalEntitySelectionContext({
				organizationId,
				requestedLegalEntityId: resolvedSearchParams.legalEntityId ?? null,
				...legalEntityAccessScope,
			})
		: null;

	return (
		<VacationManagement
			organizationId={organizationId}
			allowedAssignmentTypes={allowedAssignmentTypes}
			selectedLegalEntityId={legalEntitySelectionContext?.selectedLegalEntityId}
		>
			{legalEntitySelectionContext ? (
				<LegalEntitySelector
					entities={legalEntitySelectionContext.entities}
					selectedLegalEntityId={legalEntitySelectionContext.selectedLegalEntityId}
				/>
			) : null}
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
							selectedLegalEntityId={legalEntitySelectionContext?.selectedLegalEntityId}
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

export default function VacationSettingsPage({
	searchParams,
}: {
	searchParams?: Promise<LegalEntitySearchParams>;
}) {
	return (
		<Suspense fallback={<VacationSettingsLoading />}>
			<VacationSettingsContent searchParams={searchParams} />
		</Suspense>
	);
}
