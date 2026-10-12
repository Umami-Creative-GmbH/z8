import type { NotificationType } from "@/lib/notifications/types";

/**
 * Notifications to an absence's deputy (#1013): named, removed, new dates and
 * the day-before reminder. Client-safe, so settings screens can label them.
 */
export type AbsenceDeputyNotificationType = Extract<
	NotificationType,
	| "absence_deputy_assigned"
	| "absence_deputy_removed"
	| "absence_deputy_dates_changed"
	| "absence_deputy_reminder"
>;
