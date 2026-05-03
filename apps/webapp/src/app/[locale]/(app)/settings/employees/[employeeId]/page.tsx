import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { legalEntity } from "@/db/schema";
import { getCurrentSettingsRouteContext, getSettingsAccessInputForUser } from "@/lib/auth-helpers";
import {
	getLegalEntitySelectionContext,
	shouldShowLegalEntitySelector,
} from "@/lib/legal-entities/access";
import { getEmployee } from "../actions";
import { EmployeeDetailPageClient } from "./employee-detail-page-client";
import { shouldUseLegalEntitySelectionContext } from "./page-utils";

export default async function EmployeeDetailPage({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	const settingsRouteContext = await getCurrentSettingsRouteContext();
	const { employeeId } = await params;

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	const employeeResult = await getEmployee(employeeId);

	if (!employeeResult.success) {
		redirect("/settings/employees");
	}

	const accessInput = await getSettingsAccessInputForUser(
		settingsRouteContext.authContext.user.id,
		organizationId,
	);
	const legalEntityAccessScope = {
		isOrgAdmin: settingsRouteContext.accessTier === "orgAdmin",
		allowedLegalEntityIds: accessInput.legalEntityAdminIds ?? [],
	};
	const legalEntitySelectionContext =
		shouldShowLegalEntitySelector(legalEntityAccessScope) &&
		shouldUseLegalEntitySelectionContext({
			accessTier: settingsRouteContext.accessTier,
			employeeLegalEntityId: employeeResult.data.legalEntityId,
			allowedLegalEntityIds: legalEntityAccessScope.allowedLegalEntityIds,
		})
			? await getLegalEntitySelectionContext({
					organizationId,
					requestedLegalEntityId: employeeResult.data.legalEntityId,
					...legalEntityAccessScope,
				})
			: null;
	const fallbackLegalEntities = legalEntitySelectionContext
		? []
		: await db
				.select({ id: legalEntity.id, name: legalEntity.name })
				.from(legalEntity)
				.where(
					and(
						eq(legalEntity.id, employeeResult.data.legalEntityId),
						eq(legalEntity.organizationId, organizationId),
					),
				)
				.limit(1);
	const legalEntities = legalEntitySelectionContext?.entities ?? fallbackLegalEntities;

	return (
		<EmployeeDetailPageClient
			params={Promise.resolve({ employeeId })}
			accessTier={settingsRouteContext.accessTier}
			legalEntities={legalEntities}
		/>
	);
}
