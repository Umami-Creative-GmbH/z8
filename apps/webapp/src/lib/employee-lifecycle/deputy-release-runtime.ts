import "server-only";

import { db } from "@/db";
import { createNotification } from "@/lib/notifications/notification-service";
import { resolveRecipientNotificationLocale } from "@/lib/notifications/recipient-locale";
import type { ReleasedDeputyAssignments } from "./deputy-release";
import { notifyDeputyUnavailableAfterCommit } from "./deputy-release-notifications";

/**
 * Production after-commit notifications for a deactivation that cleared the
 * employee as deputy (#1014). Best effort: a failure is logged and never
 * undoes the committed deactivation.
 */
export function notifyReleasedDeputyAssignments(
	released: ReleasedDeputyAssignments | null | undefined,
): Promise<void> {
	return notifyDeputyUnavailableAfterCommit(
		{
			database: db,
			transport: {
				send: (params) => createNotification(params),
				locale: resolveRecipientNotificationLocale,
			},
		},
		released,
	);
}
