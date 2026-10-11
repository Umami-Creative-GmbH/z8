import "server-only";

import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";

/**
 * Revokes the report share links whose creator an access change just took
 * a project away from: removal as project manager, a role change or a
 * deactivation (#806). Called after the change committed; it never fails the
 * change. Opening a link checks the same, and the share link sweep retries.
 */
export async function revokeShareLinksAfterAccessChange(input: {
	organizationId: string;
	creator: { userId: string } | { employeeId: string };
	actorUserId: string | null;
}): Promise<void> {
	try {
		// Loaded on use: the settings actions that call this never load the report readers.
		const { revokeShareLinksCreatorsCannotSee } = await import("./report-share-links");
		await revokeShareLinksCreatorsCannotSee(db, {
			organizationId: input.organizationId,
			...("userId" in input.creator
				? { creatorUserId: input.creator.userId }
				: { creatorEmployeeId: input.creator.employeeId }),
			actorUserId: input.actorUserId,
			now: systemClock.nowInstant(),
		});
	} catch (error) {
		const { createLogger } = await import("@/lib/logger");
		createLogger("ReportShareLinks").warn(
			{ error, organizationId: input.organizationId },
			"Revoking report share links after an access change failed; the sweep retries",
		);
	}
}
