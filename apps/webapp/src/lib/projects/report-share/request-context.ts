import "server-only";

import { getClientIp } from "@/lib/rate-limit";
import type { RequestContext } from "./report-share-links";

/** The client IP and user agent a share link action or view records (#806). */
export function shareRequestContext(requestHeaders: Headers): RequestContext {
	const ipAddress = getClientIp(new Request("http://localhost", { headers: requestHeaders }));
	return {
		ipAddress: ipAddress === "unknown" ? null : ipAddress,
		userAgent: requestHeaders.get("user-agent"),
	};
}
