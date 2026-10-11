import "server-only";

import { db } from "@/db";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import { periodSubmissionOverviewScope } from "@/lib/time-tracking/period-submissions/overview";
import {
	loadPeriodSubmissionOverview,
	type PeriodSubmissionOverview,
} from "@/lib/time-tracking/period-submissions/overview-store";

export type PeriodSubmissionOverviewResult =
	| { status: "ok"; scope: "all" | "managed"; overview: PeriodSubmissionOverview }
	| { status: "forbidden" };

/**
 * The period submission status overview (#1063) for the session's active organization. Owners
 * and admins see every covered employee, managers the employees they manage; everyone else is
 * refused.
 */
export async function getPeriodSubmissionOverview(
	requestedPeriod: string | null,
): Promise<PeriodSubmissionOverviewResult> {
	const context = await getCurrentSettingsRouteContext();
	const organizationId = context?.authContext.session.activeOrganizationId;
	if (!context || !organizationId) return { status: "forbidden" };
	const scope = periodSubmissionOverviewScope({
		accessTier: context.accessTier,
		organizationId,
		employee: context.authContext.employee ?? null,
	});
	if (!scope) return { status: "forbidden" };
	const overview = await loadPeriodSubmissionOverview(db, {
		organizationId,
		scope,
		requestedPeriod,
		now: systemClock.nowInstant(),
	});
	return { status: "ok", scope: scope.kind, overview };
}
