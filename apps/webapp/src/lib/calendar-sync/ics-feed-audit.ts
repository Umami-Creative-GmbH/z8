/**
 * Audit entries for ICS feed credential changes (#991).
 *
 * Neither the secret nor its digest is ever written to the audit log.
 * Feed fetches are not audited; they only update `ics_feed.last_used_at`.
 */

import { type AuditAction, logAudit } from "@/lib/audit-logger";
import { getClientIp } from "@/lib/rate-limit";

export function logIcsFeedAudit(params: {
	action:
		| AuditAction.ICS_FEED_CREATED
		| AuditAction.ICS_FEED_REGENERATED
		| AuditAction.ICS_FEED_REVOKED;
	feed: {
		id: string;
		organizationId: string;
		feedType: "user" | "team";
		employeeId: string | null;
		teamId: string | null;
	};
	actor: { id: string; email: string };
	request: Request;
}): Promise<void> {
	const { action, feed, actor, request } = params;
	return logAudit({
		action,
		actorId: actor.id,
		actorEmail: actor.email,
		employeeId: feed.employeeId ?? undefined,
		targetId: feed.id,
		targetType: "ics_feed",
		organizationId: feed.organizationId,
		metadata: {
			feedType: feed.feedType,
			teamId: feed.teamId,
		},
		timestamp: new Date(),
		ipAddress: getClientIp(request),
		userAgent: request.headers.get("user-agent") ?? undefined,
	});
}
