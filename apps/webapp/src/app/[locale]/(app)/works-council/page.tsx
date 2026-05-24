import { DateTime } from "luxon";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { WorksCouncilDashboard } from "@/components/works-council/works-council-dashboard";
import { requireAbility, requireUser } from "@/lib/auth-helpers";
import { canViewWorksCouncilPortal } from "@/lib/works-council/permissions";
import { buildWorksCouncilPortalModel } from "@/lib/works-council/review-data";
import { loadWorksCouncilSettings } from "@/lib/works-council/settings";

function getDefaultRange() {
	const now = DateTime.utc();
	return {
		dateRangeStart: now.startOf("month").toJSDate(),
		dateRangeEnd: now.endOf("month").toJSDate(),
	};
}

export default async function WorksCouncilPage() {
	await connection();

	const authContext = await requireUser();
	const organizationId = authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/");
	}

	const ability = await requireAbility();
	if (
		!canViewWorksCouncilPortal(ability, organizationId, authContext.session.activeOrganizationId)
	) {
		redirect("/");
	}

	const settings = await loadWorksCouncilSettings(organizationId);
	const range = getDefaultRange();
	const model = await buildWorksCouncilPortalModel({
		organizationId,
		actorUserId: authContext.user.id,
		settings,
		...range,
	});

	return <WorksCouncilDashboard model={model} />;
}
