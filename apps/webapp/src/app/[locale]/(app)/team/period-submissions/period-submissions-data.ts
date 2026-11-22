import "server-only";

import { db } from "@/db";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import { periodSubmissionOverviewScope } from "@/lib/time-tracking/period-submissions/overview";
import {
	loadPeriodSubmissionOverview,
	type PeriodSubmissionOverview,
} from "@/lib/time-tracking/period-submissions/overview-store";

export type PeriodSubmissionOverviewResult =
	| { status: "ok"; scope: "all" | "managed"; overview: PeriodSubmissionOverview }
	| { status: "forbidden" }
	| { status: "unavailable" };

export interface PeriodSubmissionsAccess {
	userId: string;
	organizationId: string;
	scope: "all" | "managed";
}

export async function getPeriodSubmissionsAccess(): Promise<PeriodSubmissionsAccess | null> {
	const caller = await getCurrentSettingsAccess();
	if (!caller) return null;
	const organizationId = caller.organizationId;
	const scope = periodSubmissionOverviewScope({
		settingsAccess: caller.settingsAccess,
		organizationId,
		employee: caller.employee ? { id: caller.employee.id, organizationId } : null,
	});
	return scope ? { userId: caller.userId, organizationId, scope: scope.kind } : null;
}

/**
 * The period submission status overview (#1063) for the session's active organization. Owners
 * and admins see every covered employee, managers the employees they manage; everyone else is
 * refused.
 */
export async function getPeriodSubmissionOverview(
	requestedPeriod: string | null,
	expected: Pick<PeriodSubmissionsAccess, "userId" | "organizationId">,
): Promise<PeriodSubmissionOverviewResult> {
	const caller = await getCurrentSettingsAccess();
	if (!caller) return { status: "forbidden" };
	const organizationId = caller.organizationId;
	if (expected.userId !== caller.userId || expected.organizationId !== organizationId)
		return { status: "forbidden" };
	const scope = periodSubmissionOverviewScope({
		settingsAccess: caller.settingsAccess,
		organizationId,
		employee: caller.employee ? { id: caller.employee.id, organizationId } : null,
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
