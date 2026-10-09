import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization } from "@/db/auth-schema";
import { personnelFileDueNotice, personnelFileDueReminder } from "@/db/schema";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { listPersonnelFileNotificationRecipients } from "./notification-recipients";
import { type DueDocument, findDueDocuments } from "./retention-store";

/**
 * The daily due-for-deletion reminder (#870). For every organization with
 * personnel files on, documents that are due and were not reported for their
 * current retention start are **newly due**. Their covering officers (owners
 * and admins when no officer covers them) get one notification per
 * organization day: a recipient already told today hears about later
 * documents the next day. A document counts as reported once all its
 * recipients were told. Nothing is ever deleted here.
 */

const logger = createLogger("PersonnelFileRetentionReminders");

type Database = typeof appDb;

export const DUE_FOR_DELETION_PATH = "/personnel-files/due-for-deletion";

const dueCopy = {
	titleKey: "common:notifications.content.personnelFileDueForDeletion.title",
	titleDefault: "Documents due for deletion",
	messageKey: "common:notifications.content.personnelFileDueForDeletion.message",
	messageDefault:
		"{count, plural, one {# employee document is} other {# employee documents are}} now due for deletion. Review and confirm the purge.",
} as const;

export function buildDueForDeletionNotification(input: {
	organizationId: string;
	recipientUserId: string;
	/** The organization's calendar day, YYYY-MM-DD. */
	localDate: string;
	documentCount: number;
}): CreateNotificationParams {
	const count = input.documentCount;
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: "personnel_file_due_for_deletion",
		title: dueCopy.titleDefault,
		message:
			count === 1
				? "1 employee document is now due for deletion. Review and confirm the purge."
				: `${count} employee documents are now due for deletion. Review and confirm the purge.`,
		actionUrl: DUE_FOR_DELETION_PATH,
		idempotencyKey: `personnel-file-due:${input.organizationId}:${input.localDate}:${input.recipientUserId}`,
		metadata: {
			documentCount: count,
			localDate: input.localDate,
			i18n: { ...dueCopy, params: { count } },
		},
	};
}

export interface RetentionRemindersResult {
	organizations: number;
	newlyDue: number;
	notified: number;
}

async function remindOrganization(
	database: Database,
	organizationId: string,
	now: Instant,
): Promise<{ newlyDue: number; notified: number }> {
	const { today, documents } = await findDueDocuments(database, { organizationId, now });
	if (documents.length === 0) return { newlyDue: 0, notified: 0 };
	const reported = await database
		.select({
			documentId: personnelFileDueNotice.documentId,
			retentionStart: personnelFileDueNotice.retentionStart,
		})
		.from(personnelFileDueNotice)
		.where(
			and(
				eq(personnelFileDueNotice.organizationId, organizationId),
				inArray(
					personnelFileDueNotice.documentId,
					documents.map((document) => document.id),
				),
			),
		);
	const reportedKeys = new Set(reported.map((row) => `${row.documentId}:${row.retentionStart}`));
	const fresh = documents.filter(
		(document) => !reportedKeys.has(`${document.id}:${document.retentionStart}`),
	);
	if (fresh.length === 0) return { newlyDue: 0, notified: 0 };

	const recipientsByKey = new Map<string, Promise<string[]>>();
	const recipientsOf = (document: DueDocument) => {
		const key = `${document.employeeId}:${document.category}`;
		let recipients = recipientsByKey.get(key);
		if (!recipients) {
			recipients = listPersonnelFileNotificationRecipients(database, {
				organizationId,
				employeeId: document.employeeId,
				category: document.category,
				now,
			});
			recipientsByKey.set(key, recipients);
		}
		return recipients;
	};
	const recipientsByDocument = new Map<string, string[]>();
	const documentsByRecipient = new Map<string, number>();
	// Recipient lookups populate a shared cache consumed by subsequent documents.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const document of fresh) {
		const recipients = await recipientsOf(document);
		recipientsByDocument.set(document.id, recipients);
		for (const userId of recipients) {
			documentsByRecipient.set(userId, (documentsByRecipient.get(userId) ?? 0) + 1);
		}
	}

	const told = new Set<string>();
	// Claim before delivery and record the recipients already told; notification pressure stays bounded.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const [userId, documentCount] of documentsByRecipient) {
		const [claimed] = await database
			.insert(personnelFileDueReminder)
			.values({ organizationId, userId, localDate: today })
			.onConflictDoNothing()
			.returning({ id: personnelFileDueReminder.id });
		if (!claimed) continue;
		await createNotification(
			buildDueForDeletionNotification({
				organizationId,
				recipientUserId: userId,
				localDate: today,
				documentCount,
			}),
		);
		told.add(userId);
	}

	const reportedNow = fresh.filter((document) =>
		(recipientsByDocument.get(document.id) ?? []).every((userId) => told.has(userId)),
	);
	if (reportedNow.length > 0) {
		await database
			.insert(personnelFileDueNotice)
			.values(
				reportedNow.map((document) => ({
					organizationId,
					documentId: document.id,
					retentionStart: document.retentionStart,
					noticedOn: today,
				})),
			)
			.onConflictDoNothing();
	}
	return { newlyDue: fresh.length, notified: told.size };
}

/**
 * Runs the reminder for every organization with personnel files on (or the
 * given ones, still only while on). One organization's failure does not stop
 * the others.
 */
export async function runPersonnelFileRetentionReminders(
	database: Database,
	options: { now?: Instant; organizationIds?: readonly string[] } = {},
): Promise<RetentionRemindersResult> {
	const now = options.now ?? systemClock.nowInstant();
	const organizations = await database
		.select({ id: organization.id })
		.from(organization)
		.where(
			and(
				eq(organization.personnelFilesEnabled, true),
				options.organizationIds
					? inArray(organization.id, [...options.organizationIds])
					: undefined,
			),
		);
	const result: RetentionRemindersResult = { organizations: 0, newlyDue: 0, notified: 0 };
	// One tenant at a time keeps failures and shared notification capacity isolated.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const { id } of organizations) {
		try {
			const outcome = await remindOrganization(database, id, now);
			result.organizations += 1;
			result.newlyDue += outcome.newlyDue;
			result.notified += outcome.notified;
		} catch (error) {
			logger.error({ error, organizationId: id }, "Personnel file retention reminder failed");
		}
	}
	return result;
}
