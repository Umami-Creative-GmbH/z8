import "server-only";

import { db } from "@/db";
import { createNotification } from "@/lib/notifications/notification-service";
import { resolveRecipientNotificationLocale } from "@/lib/notifications/recipient-locale";
import type { ReleasedDeputyAssignments } from "./deputy-release";
import { notifyDeputyUnavailableAfterCommit } from "./deputy-release-notifications";

/**
 * Production after-commit step for a deactivation that cleared the employee
 * as deputy (#1014): forwards its audit entries and notifies. Best effort: a
 * failure is logged and never undoes the committed deactivation. An effect
 * passes its `DatabaseService` client.
 */
export function notifyReleasedDeputyAssignments(
	released: ReleasedDeputyAssignments | null | undefined,
	database: Pick<typeof db, "select" | "query"> = db,
): Promise<void> {
	return notifyDeputyUnavailableAfterCommit(
		{
			database,
			transport: {
				send: (params) => createNotification(params),
				locale: resolveRecipientNotificationLocale,
			},
		},
		released,
	);
}
