export const NOTIFICATION_USER_HEADER = "x-z8-notification-user";
export const NOTIFICATION_ORGANIZATION_HEADER =
	"x-z8-notification-organization";
export const NOTIFICATION_SCOPE_CHANGED =
	"Your account or organization changed. Refresh and try again.";

/** Expectations prevent an in-flight request from being stored under a previous identity's key.
 * They never authorize a request; the freshly authenticated session remains authoritative. */
export function matchesNotificationRequestScope(
	headers: Headers | undefined,
	current: { userId: string; organizationId: string },
): boolean {
	const userId = headers?.get(NOTIFICATION_USER_HEADER);
	const organizationId = headers?.get(NOTIFICATION_ORGANIZATION_HEADER);
	return (
		(userId == null || userId === current.userId) &&
		(organizationId == null || organizationId === current.organizationId)
	);
}
