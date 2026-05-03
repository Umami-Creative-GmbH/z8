import { connection } from "next/server";
import { redirect } from "next/navigation";
import { LegalEntitySelector } from "@/components/settings/legal-entities/legal-entity-selector";
import { WorkPolicyManagement } from "@/components/settings/work-policy-management";
import { getCurrentSettingsRouteContext, getSettingsAccessInputForUser } from "@/lib/auth-helpers";
import { getLegalEntitySelectionContext } from "@/lib/legal-entities/access";

type LegalEntitySearchParams = {
	legalEntityId?: string;
};

export default async function WorkPoliciesPage({
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

	const accessInput = await getSettingsAccessInputForUser(settingsRouteContext.authContext.user.id, organizationId);
	const { entities, selectedLegalEntityId } = await getLegalEntitySelectionContext({
		organizationId,
		requestedLegalEntityId: resolvedSearchParams.legalEntityId ?? null,
		isOrgAdmin: settingsRouteContext.accessTier === "orgAdmin",
		allowedLegalEntityIds: accessInput.legalEntityAdminIds ?? [],
	});

	return (
		<>
			<div className="px-4 pt-4">
				<LegalEntitySelector entities={entities} selectedLegalEntityId={selectedLegalEntityId} />
			</div>
			<WorkPolicyManagement
				organizationId={organizationId}
				accessTier={settingsRouteContext.accessTier}
			/>
		</>
	);
}
