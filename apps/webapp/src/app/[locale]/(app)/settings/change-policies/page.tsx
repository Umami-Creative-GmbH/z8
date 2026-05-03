import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getTranslate } from "@/tolgee/server";
import { ChangePolicyManagement } from "@/components/settings/change-policy-management";
import { LegalEntitySelector } from "@/components/settings/legal-entities/legal-entity-selector";
import { getCurrentSettingsRouteContext, getSettingsAccessInputForUser } from "@/lib/auth-helpers";
import { getLegalEntitySelectionContext } from "@/lib/legal-entities/access";

type LegalEntitySearchParams = {
	legalEntityId?: string;
};

export default async function ChangePoliciesSettingsPage({
	searchParams,
}: {
	searchParams?: Promise<LegalEntitySearchParams>;
}) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const [, settingsRouteContext, resolvedSearchParams] = await Promise.all([
		getTranslate(),
		getCurrentSettingsRouteContext(),
		searchParams ?? Promise.resolve({} as LegalEntitySearchParams),
	]);

	if (!settingsRouteContext) {
		redirect("/settings");
	}

	const { authContext, accessTier } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (accessTier === "member" || !organizationId) {
		redirect("/settings");
	}

	const accessInput = await getSettingsAccessInputForUser(authContext.user.id, organizationId);
	const { entities, selectedLegalEntityId } = await getLegalEntitySelectionContext({
		organizationId,
		requestedLegalEntityId: resolvedSearchParams.legalEntityId ?? null,
		isOrgAdmin: accessTier === "orgAdmin",
		allowedLegalEntityIds: accessInput.legalEntityAdminIds ?? [],
	});

	return (
		<>
			<div className="px-4 pt-4">
				<LegalEntitySelector entities={entities} selectedLegalEntityId={selectedLegalEntityId} />
			</div>
			<ChangePolicyManagement
				organizationId={organizationId}
				canManage={accessTier === "orgAdmin"}
			/>
		</>
	);
}
