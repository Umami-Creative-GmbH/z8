"use server";

import { eq } from "drizzle-orm";
import { positionNotice } from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
import { instantToCanonicalString, systemClock } from "@/lib/datetime/temporal-core";
import {
	AuthenticationError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { runPositionCaptureAction } from "@/lib/time-tracking/position-capture/action-runner";
import {
	loadPositionStampViewer,
	mayViewEveryonesPositionStamps,
} from "@/lib/time-tracking/position-capture/viewer";
import { showWorkPeriodPositions } from "@/lib/time-tracking/position-capture/work-period-positions";

export type PositionStampViewerAccessData = {
	/** Whether the organization has ever published a position notice (no notice, no stamps). */
	available: boolean;
	ownEmployeeId: string | null;
	mayViewOthers: boolean;
};

export type WorkPeriodPositionStampData = {
	event: "clock_in" | "clock_out";
	latitude: number;
	longitude: number;
	accuracyMeters: number;
	fixedAt: string;
	eventAt: string;
	eventUtcOffsetMinutes: number;
	originalEvent: boolean;
};

export type WorkPeriodPositionsData = {
	workPeriodId: string;
	stamps: WorkPeriodPositionStampData[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether the work period detail offers "Show positions": for the viewer's own
 * work periods, or for everyone's when they may see all stamps. The server
 * checks again on every "Show positions".
 */
export async function getPositionStampViewerAccessAction(): Promise<
	ServerActionResult<PositionStampViewerAccessData>
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
}): Promise<ServerActionResult<WorkPeriodPositionsData>> {
	return runPositionCaptureAction("positionStamps.showWorkPeriod", async (db) => {
		const { organizationId, userId } = await requireOrganizationUser();
		const workPeriodId = input?.workPeriodId;
		if (typeof workPeriodId !== "string" || !UUID_PATTERN.test(workPeriodId)) {
			throw new ValidationError({ message: "Invalid work period.", field: "workPeriodId" });
		}
		const result = await showWorkPeriodPositions(db, {
			organizationId,
			viewerUserId: userId,
			workPeriodId,
			now: systemClock.nowInstant(),
		});
		if (result.kind === "not_found") {
			throw new NotFoundError({ message: "Work period not found.", entityType: "work_period" });
		}
		if (result.kind === "forbidden") {
			throw new AuthorizationError({
				message: "You are not allowed to see positions for this work period.",
			});
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
		throw new AuthenticationError({ message: "Sign in to an organization first." });
	}
	return { organizationId, userId: authContext.user.id };
}
