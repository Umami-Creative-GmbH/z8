import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	deleteShareLinkViewsPastAuditLifetime,
	sweepShareLinks,
} from "@/lib/projects/report-share/report-share-links";

/**
 * Expires report share links past their expiry and revokes the links whose
 * creator can no longer see every project in them, deleting their snapshots
 * (#806). Opening a link checks both too; the sweep deletes snapshots nobody
 * opens and catches departures and deactivations.
 */
export async function runReportShareLinkSweep(): Promise<{
	expired: number;
	creatorLostAccess: number;
}> {
	return sweepShareLinks(db, { now: systemClock.nowInstant() });
}

/**
 * Deletes recipient views of report share links past the audit-log lifetime
 * (#806). Runs with the audit-log cleanup, so the view log lives exactly as
 * long as audit logs do.
 */
export async function runReportShareLinkViewRetention(lifetimeDays: number): Promise<number> {
	return deleteShareLinkViewsPastAuditLifetime(db, {
		now: systemClock.nowInstant(),
		lifetimeDays,
	});
}
