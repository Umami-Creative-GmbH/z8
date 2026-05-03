import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LegalEntitySelector } from "@/components/settings/legal-entities/legal-entity-selector";
import { getCurrentSettingsRouteContext, getSettingsAccessInputForUser } from "@/lib/auth-helpers";
import {
	getLegalEntitySelectionContext,
	shouldShowLegalEntitySelector,
} from "@/lib/legal-entities/access";
import { EmployeesPageClient } from "./employees-page-client";

type EmployeeSearchParams = {
	legalEntityId?: string;
};

export default async function EmployeesPage({
	searchParams,
}: {
	searchParams?: Promise<EmployeeSearchParams>;
}) {
	await connection();

	const [settingsRouteContext, resolvedSearchParams] = await Promise.all([
		getCurrentSettingsRouteContext(),
		searchParams ?? Promise.resolve({} as EmployeeSearchParams),
	]);

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	const accessInput = await getSettingsAccessInputForUser(
		settingsRouteContext.authContext.user.id,
		organizationId,
	);
	const legalEntityAccessScope = {
		isOrgAdmin: settingsRouteContext.accessTier === "orgAdmin",
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
		<>
			{legalEntitySelectionContext ? (
				<div className="px-4 pt-4">
					<LegalEntitySelector
						entities={legalEntitySelectionContext.entities}
						selectedLegalEntityId={legalEntitySelectionContext.selectedLegalEntityId}
					/>
				</div>
			) : null}
			<EmployeesPageClient
				accessTier={settingsRouteContext.accessTier}
				organizationId={organizationId}
				selectedLegalEntityId={legalEntitySelectionContext?.selectedLegalEntityId}
			/>
		</>
	);
}
