"use server";

import { db } from "@/db";
import type { CoverDuties } from "@/lib/absences/cover-duties";
import { loadCoverDuties, loadDeputyViewer } from "@/lib/absences/deputy-display-store";
import { systemClock } from "@/lib/datetime/temporal-core";
import type { ServerActionResult } from "@/lib/effect/result";
import { createLogger } from "@/lib/logger";

const logger = createLogger("DashboardCoverDuties");

/**
 * The signed-in employee's cover duties in the active organization (#1012):
 * the approved absences they are deputy on that run now or start within the
 * next 14 days. Nothing beyond the absent person's name, the dates and, where
 * the viewer could already see it, the category.
 */
export async function getCoverDuties(): Promise<ServerActionResult<CoverDuties>> {
	try {
		const { getRequestSession } = await import("@/lib/auth/request-session");
		const session = await getRequestSession();
		const organizationId = session?.session.activeOrganizationId;
		if (!session?.user || !organizationId) {
			return { success: false, error: "Authentication required", code: "AuthenticationError" };
		}
		const viewer = await loadDeputyViewer(db, { organizationId, userId: session.user.id });
		if (!viewer) return { success: true, data: { running: [], upcoming: [] } };
		return {
			success: true,
			data: await loadCoverDuties(db, { organizationId, viewer, now: systemClock.nowInstant() }),
		};
	} catch (error) {
		logger.error({ error }, "Failed to load cover duties");
		return { success: false, error: "Failed to load cover duties", code: "UNKNOWN_ERROR" };
	}
}
