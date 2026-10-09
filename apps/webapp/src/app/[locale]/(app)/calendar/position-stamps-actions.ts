"use server";

import { eq } from "drizzle-orm";
import { positionNotice } from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
import { instantToCanonicalString, systemClock } from "@/lib/datetime/temporal-core";
import { runPositionCaptureAction } from "@/lib/time-tracking/position-capture/action-runner";
import {
	type PositionCaptureActionResult,
	PositionCaptureRefusal,
	requireUuid,
} from "@/lib/time-tracking/position-capture/errors";
import {
	loadPositionStampViewer,
	mayViewEveryonesPositionStamps,
} from "@/lib/time-tracking/position-capture/viewer";
import {
	showWorkPeriodPositions,
	type WorkPeriodPositionStamp,
} from "@/lib/time-tracking/position-capture/work-period-positions";

export type PositionStampViewerAccessData = {
	/** Whether the organization has ever published a position notice (no notice, no stamps). */
	available: boolean;
	ownEmployeeId: string | null;
	mayViewOthers: boolean;
};

/** A `WorkPeriodPositionStamp` for the client: its instants as ISO strings. */
export type WorkPeriodPositionStampData = Omit<WorkPeriodPositionStamp, "fixedAt" | "eventAt"> & {
	fixedAt: string;
	eventAt: string;
};

export type WorkPeriodPositionsData = {
	workPeriodId: string;
	stamps: WorkPeriodPositionStampData[];
};

/**
 * Whether the work period detail offers "Show positions": for the viewer's own
 * work periods, or for everyone's when they may see all stamps. The server
 * checks again on every "Show positions".
 */
export async function getPositionStampViewerAccessAction(): Promise<
	PositionCaptureActionResult<PositionStampViewerAccessData>
> {
	return runPositionCaptureAction("positionStamps.viewerAccess", async (db) => {
		const { organizationId, userId } = await requireOrganizationUser();
		const [viewer, [notice]] = await Promise.all([
			loadPositionStampViewer(db, { organizationId, userId }),
			db
				.select({ id: positionNotice.id })
				.from(positionNotice)
				.where(eq(positionNotice.organizationId, organizationId))
				.limit(1),
		]);
		return {
			available: Boolean(notice),
			ownEmployeeId: viewer.ownEmployeeId,
			mayViewOthers: mayViewEveryonesPositionStamps(viewer),
		};
	});
}

/**
 * "Show positions" on one work period. Logs the access when the viewer is not
 * the employee. Positions are never part of the calendar payload.
 */
export async function showWorkPeriodPositionsAction(input: {
	workPeriodId: string;
}): Promise<PositionCaptureActionResult<WorkPeriodPositionsData>> {
	return runPositionCaptureAction("positionStamps.showWorkPeriod", async (db) => {
		const { organizationId, userId } = await requireOrganizationUser();
		const workPeriodId = requireUuid(input?.workPeriodId, {
			code: "invalid_work_period",
			message: "Invalid work period.",
		});
		const result = await showWorkPeriodPositions(db, {
			organizationId,
			viewerUserId: userId,
			workPeriodId,
			now: systemClock.nowInstant(),
		});
		if (result.kind === "not_found") {
			throw new PositionCaptureRefusal("work_period_not_found", "Work period not found.");
		}
		if (result.kind === "forbidden") {
			throw new PositionCaptureRefusal(
				"positions_forbidden",
				"You are not allowed to see positions for this work period.",
			);
		}
		return {
			workPeriodId,
			stamps: result.stamps.map((stamp) => ({
				...stamp,
				fixedAt: instantToCanonicalString(stamp.fixedAt),
				eventAt: instantToCanonicalString(stamp.eventAt),
			})),
		};
	});
}

async function requireOrganizationUser(): Promise<{ organizationId: string; userId: string }> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId ?? null;
	if (!authContext || !organizationId) {
		throw new PositionCaptureRefusal("sign_in_required", "Sign in to an organization first.");
	}
	return { organizationId, userId: authContext.user.id };
}
