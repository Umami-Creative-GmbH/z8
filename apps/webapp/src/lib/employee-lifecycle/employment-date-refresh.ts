import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { createLogger } from "@/lib/logger";
import { refreshTrackingDateResults } from "@/lib/time-tracking/tracking-date-refresh";
import type { TrackingDateImpact } from "@/lib/time-tracking/tracking-date-review-types";

const logger = createLogger("EmploymentDateCorrection");
export async function refreshEmploymentDateResults(
	organizationId: string,
	impact: TrackingDateImpact,
) {
	const pending = await refreshTrackingDateResults(organizationId, impact);
	try {
		for (const path of ["/absences", "/team/absences", "/settings/vacation", "/settings/employees"])
			revalidatePath(path);
		revalidateTag(CACHE_TAGS.VACATION_POLICY(organizationId), { expire: 0 });
	} catch (error) {
		logger.error(
			{ error, organizationId },
			"Employment date committed; vacation cache invalidation failed",
		);
	}
	return pending;
}
