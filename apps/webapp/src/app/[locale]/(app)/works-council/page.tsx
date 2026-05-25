import { DateTime } from "luxon";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { WorksCouncilDashboard } from "@/components/works-council/works-council-dashboard";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { requireAbility, requireUser } from "@/lib/auth-helpers";
import { auditWorksCouncilPortalViewed } from "@/lib/works-council/access-audit";
import { canViewWorksCouncilPortal } from "@/lib/works-council/permissions";
import { buildWorksCouncilPortalModel } from "@/lib/works-council/review-data";
import { loadWorksCouncilSettings } from "@/lib/works-council/settings";

function getRange(searchParams?: { from?: string; to?: string }) {
	const now = DateTime.utc();
	const from = searchParams?.from
		? DateTime.fromISO(searchParams.from, { zone: "utc" }).startOf("day")
		: now.startOf("month");
	const to = searchParams?.to
		? DateTime.fromISO(searchParams.to, { zone: "utc" }).endOf("day")
		: now.endOf("month");

	if (!from.isValid || !to.isValid || from > to) {
		return {
			dateRangeStart: now.startOf("month").toJSDate(),
			dateRangeEnd: now.endOf("month").toJSDate(),
		};
	}

	return {
		dateRangeStart: from.toJSDate(),
		dateRangeEnd: to.toJSDate(),
	};
}

export default async function WorksCouncilPage({
	searchParams,
}: {
	searchParams?: Promise<{ from?: string; to?: string }>;
}) {
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

	const currentOrganization = await db.query.organization.findFirst({
		columns: { worksCouncilEnabled: true },
		where: eq(organization.id, organizationId),
	});
	if (!currentOrganization?.worksCouncilEnabled) {
		redirect("/");
	}

	const settings = await loadWorksCouncilSettings(organizationId);
	const range = getRange(await searchParams);
	await auditWorksCouncilPortalViewed({
		organizationId,
		actorUserId: authContext.user.id,
		settings,
		...range,
	});
	const model = await buildWorksCouncilPortalModel({
		organizationId,
		actorUserId: authContext.user.id,
		settings,
		...range,
	});

	return <WorksCouncilDashboard model={model} />;
}
