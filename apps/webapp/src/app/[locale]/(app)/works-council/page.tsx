import { eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { WorksCouncilDashboard } from "@/components/works-council/works-council-dashboard";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { requireAbility, requireUser } from "@/lib/auth-helpers";
import {
	comparePlainDates,
	dateFromInstant,
	parseInstant,
	parsePlainDate,
	type PlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { auditWorksCouncilPortalViewed } from "@/lib/works-council/access-audit";
import { canViewWorksCouncilPortal } from "@/lib/works-council/permissions";
import { loadWorksCouncilPositionCaptureReview } from "@/lib/works-council/position-capture-review-data";
import { buildWorksCouncilPortalModel } from "@/lib/works-council/review-data";
import { loadWorksCouncilSettings } from "@/lib/works-council/settings";
import { loadWorksCouncilVehicleUseReview } from "@/lib/works-council/vehicle-use-review-data";
import { getTranslate } from "@/tolgee/server";

function parseUtcDateParam(value: string): PlainDate | null {
	try {
		return parsePlainDate(value);
	} catch {
		try {
			return parseInstant(value).toZonedDateTimeISO("UTC").toPlainDate();
		} catch {
			return null;
		}
	}
}

function utcDayRange(startDate: PlainDate, endDate: PlainDate) {
	return {
		dateRangeStart: dateFromInstant(startDate.toZonedDateTime("UTC").toInstant()),
		dateRangeEnd: dateFromInstant(
			endDate.add({ days: 1 }).toZonedDateTime("UTC").toInstant().subtract({ milliseconds: 1 }),
		),
	};
}

function getRange(searchParams?: { from?: string; to?: string }) {
	const today = systemClock.nowInstant().toZonedDateTimeISO("UTC").toPlainDate();
	const monthStart = today.with({ day: 1 });
	const monthEnd = monthStart.add({ months: 1 }).subtract({ days: 1 });

	const from = searchParams?.from ? parseUtcDateParam(searchParams.from) : monthStart;
	const to = searchParams?.to ? parseUtcDateParam(searchParams.to) : monthEnd;

	if (!from || !to || comparePlainDates(from, to) > 0) {
		return utcDayRange(monthStart, monthEnd);
	}

	return utcDayRange(from, to);
}

type WorksCouncilPageProps = {
	searchParams?: Promise<{ from?: string; to?: string }>;
};

async function WorksCouncilPageContent({ searchParams }: WorksCouncilPageProps) {
	// This protected view must execute per request so authorization and audit are not reused.
	await connection();
	const authContext = await requireUser();
	const organizationId = authContext.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/");
	}

	const ability = await requireAbility();
	if (
		!canViewWorksCouncilPortal(ability, organizationId, authContext.session.activeOrganizationId)
	) {
		return redirectWithLocale("/");
	}

	const currentOrganization = await db.query.organization.findFirst({
		columns: { worksCouncilEnabled: true, timezone: true },
		where: eq(organization.id, organizationId),
	});
	if (!currentOrganization?.worksCouncilEnabled) {
		return redirectWithLocale("/");
	}

	const settings = await loadWorksCouncilSettings(organizationId);
	const range = getRange(await searchParams);
	await auditWorksCouncilPortalViewed({
		organizationId,
		actorUserId: authContext.user.id,
		settings,
		...range,
	});
	const [model, positionCaptureReview, vehicleUseReview, locale] = await Promise.all([
		buildWorksCouncilPortalModel({
			organizationId,
			actorUserId: authContext.user.id,
			settings,
			...range,
		}),
		loadWorksCouncilPositionCaptureReview({ organizationId, settings }),
		loadWorksCouncilVehicleUseReview({ organizationId, settings }),
		getLocale(),
	]);

	return (
		<WorksCouncilDashboard
			model={model}
			locale={locale}
			timezone={currentOrganization.timezone ?? "UTC"}
			positionCapture={{ review: positionCaptureReview, locale }}
			vehicleUse={{ review: vehicleUseReview }}
		/>
	);
}

function WorksCouncilPageLoading() {
	return (
		<LoadingRegion
			aria-busy="true"
			label={{
				labelKey: "common.loadingRegions.worksCouncilPortal",
				labelDefault: "Loading Works Council portal",
			}}
			aria-labelledby="works-council-loading-label"
			aria-live="polite"
			className="page-frame flex flex-1 flex-col gap-6"
			data-testid="works-council-loading"
			role="status"
		>
			<Suspense fallback={null}>
				<WorksCouncilLoadingStatus />
			</Suspense>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-64" />
				<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
			</div>
			<div className="grid gap-4 md:grid-cols-3">
				<Skeleton aria-hidden="true" className="h-28 w-full" />
				<Skeleton aria-hidden="true" className="h-28 w-full" />
				<Skeleton aria-hidden="true" className="h-28 w-full" />
			</div>
			<Skeleton aria-hidden="true" className="h-80 w-full" />
		</LoadingRegion>
	);
}

async function WorksCouncilLoadingStatus() {
	const t = await getTranslate();
	const loadingLabel = t("worksCouncil.loadingLabel", "Loading works council");

	return (
		<span id="works-council-loading-label" className="sr-only">
			{loadingLabel}
		</span>
	);
}

export default function WorksCouncilPage(props: WorksCouncilPageProps) {
	return (
		<Suspense fallback={<WorksCouncilPageLoading />}>
			<WorksCouncilPageContent {...props} />
		</Suspense>
	);
}
