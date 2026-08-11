import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { WorksCouncilDashboard } from "@/components/works-council/works-council-dashboard";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { requireAbility, requireUser } from "@/lib/auth-helpers";
import { auditWorksCouncilPortalViewed } from "@/lib/works-council/access-audit";
import { canViewWorksCouncilPortal } from "@/lib/works-council/permissions";
import { buildWorksCouncilPortalModel } from "@/lib/works-council/review-data";
import { loadWorksCouncilSettings } from "@/lib/works-council/settings";
import { getTranslate } from "@/tolgee/server";

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

type WorksCouncilPageProps = {
	searchParams?: Promise<{ from?: string; to?: string }>;
};

export default function WorksCouncilPage(props: WorksCouncilPageProps) {
	return (
		<Suspense fallback={<WorksCouncilLoading />}>
			<WorksCouncilContent {...props} />
		</Suspense>
	);
}

function WorksCouncilLoading() {
	return (
		<div
			aria-busy="true"
			aria-live="polite"
			className="space-y-6 p-4 md:p-6"
			data-testid="works-council-loading"
			role="status"
		>
			<Suspense fallback={null}>
				<WorksCouncilLoadingStatus />
			</Suspense>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-64 max-w-full" />
				<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
			</div>
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				<Skeleton aria-hidden="true" className="h-36 w-full" />
				<Skeleton aria-hidden="true" className="h-36 w-full" />
				<Skeleton aria-hidden="true" className="h-36 w-full" />
			</div>
			<Skeleton aria-hidden="true" className="h-72 w-full" />
		</div>
	);
}

async function WorksCouncilLoadingStatus() {
	const t = await getTranslate();
	const loadingLabel = t("worksCouncil.loadingLabel", "Loading works council");

	return <span className="sr-only">{loadingLabel}</span>;
}

async function WorksCouncilContent({ searchParams }: WorksCouncilPageProps) {
	await connection();

	const authContext = await requireUser();
	const organizationId = authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/");
	}

	const ability = await requireAbility();
	if (
		!canViewWorksCouncilPortal(
			ability,
			organizationId,
			authContext.session.activeOrganizationId,
		)
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
