import "server-only";

import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache/tags";

/** Immediate org-local hint; committed dependency revisions also version worker/API writes. */
export function revalidateWorkDataCache(organizationId: string): void {
	revalidateTag(CACHE_TAGS.RECENT_ANALYTICS(organizationId), { expire: 0 });
}
