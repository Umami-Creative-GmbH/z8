import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { employee, employeeDocument, personnelFileExpiryReminder } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { EXPIRY_DATE_CATEGORIES } from "./document.types";
import { dueExpiryReminder, type ExpiryReminderKind } from "./expiry";
import { buildExpiryReminderNotification, type ExpiringDocumentRef } from "./expiry-notifications";
import { loadExpiryReminderWindow } from "./expiry-store";
import { listPersonnelFileNotificationRecipients } from "./notification-recipients";

/**
 * The expiry reminder job (#869), run hourly so every organization's
 * calendar day is reached soon after its midnight. For each organization
 * with personnel files on it sends, per certificate or other document with an
 * expiry date, the upcoming reminder once the document is within the lead
 * time and the expired-today reminder on the expiry date.
 *
 * Recipients: the employee if the document is shared, plus the officers
 * covering the employee and the category (owners and admins when none does).
 * Former employees' documents are skipped; deleted documents no longer exist.
 *
 * At most once: a reminder is claimed in `personnel_file_expiry_reminder`
 * (unique per document, kind and expiry date) before anyone is notified, so a
 * second run, a retry or a concurrent worker sends nothing again.
 */

const logger = createLogger("PersonnelFileExpiryReminders");

type Database = typeof appDb;

export interface PersonnelFileExpiryReminderResult {
	success: boolean;
	organizationsChecked: number;
	remindersSent: number;
	notificationsSent: number;
	errors: Array<{ organizationId: string; error: string }>;
}

interface DueReminder {
	kind: ExpiryReminderKind;
	document: ExpiringDocumentRef & { visibility: "shared" | "hr_only"; employeeUserId: string };
}

export async function runPersonnelFileExpiryReminders(
	database: Database,
	input: { now: Instant },
): Promise<PersonnelFileExpiryReminderResult> {
	const result: PersonnelFileExpiryReminderResult = {
		success: true,
		organizationsChecked: 0,
		remindersSent: 0,
		notificationsSent: 0,
		errors: [],
	};
	const organizations = await database
		.select({ id: organization.id })
		.from(organization)
		.where(eq(organization.personnelFilesEnabled, true));

	for (const { id: organizationId } of organizations) {
		result.organizationsChecked += 1;
		try {
			const sent = await remindOrganization(database, { organizationId, now: input.now });
			result.remindersSent += sent.reminders;
			result.notificationsSent += sent.notifications;
		} catch (error) {
			result.success = false;
			result.errors.push({
				organizationId,
				error: error instanceof Error ? error.message : String(error),
			});
			logger.error({ error, organizationId }, "Failed to send personnel file expiry reminders");
		}
	}
	return result;
}

async function remindOrganization(
	database: Database,
	input: { organizationId: string; now: Instant },
): Promise<{ reminders: number; notifications: number }> {
	const { organizationId, now } = input;
	const { today, leadDays, windowEnd } = await loadExpiryReminderWindow(database, input);

	// A moved expiry date re-arms both reminders, also when it moves back.
	await database.execute(sql`
		DELETE FROM ${personnelFileExpiryReminder}
		WHERE ${personnelFileExpiryReminder.organizationId} = ${organizationId}
		AND NOT EXISTS (
			SELECT 1 FROM ${employeeDocument}
			WHERE ${employeeDocument.id} = ${personnelFileExpiryReminder.documentId}
			AND ${employeeDocument.organizationId} = ${organizationId}
			AND ${employeeDocument.expiryDate} = ${personnelFileExpiryReminder.expiryDate}
		)`);

	const candidates = await database
		.select({
			id: employeeDocument.id,
			employeeId: employeeDocument.employeeId,
			employeeUserId: employee.userId,
			userName: user.name,
			employeeNumber: employee.employeeNumber,
			title: employeeDocument.title,
			category: employeeDocument.category,
			visibility: employeeDocument.visibility,
			expiryDate: employeeDocument.expiryDate,
		})
		.from(employeeDocument)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeDocument.employeeId),
				eq(employee.organizationId, employeeDocument.organizationId),
			),
		)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employeeDocument.organizationId, organizationId),
				inArray(employeeDocument.category, [...EXPIRY_DATE_CATEGORIES]),
				isNotNull(employeeDocument.expiryDate),
				gte(employeeDocument.expiryDate, today),
				lte(employeeDocument.expiryDate, windowEnd),
				employeeHasOrganizationAccess(now),
			),
		);

	const due: DueReminder[] = [];
	for (const row of candidates) {
		if (!row.expiryDate) continue;
		const kind = dueExpiryReminder({ today, expiryDate: row.expiryDate, leadDays });
		if (!kind) continue;
		due.push({
			kind,
			document: {
				id: row.id,
				employeeId: row.employeeId,
				employeeUserId: row.employeeUserId,
				employeeName: row.userName?.trim() || row.employeeNumber || row.employeeId,
				title: row.title,
				category: row.category,
				visibility: row.visibility,
				expiryDate: row.expiryDate,
			},
		});
	}
	if (due.length === 0) return { reminders: 0, notifications: 0 };

	const alreadySent = new Set(
		(
			await database
				.select({
					documentId: personnelFileExpiryReminder.documentId,
					kind: personnelFileExpiryReminder.kind,
					expiryDate: personnelFileExpiryReminder.expiryDate,
				})
				.from(personnelFileExpiryReminder)
				.where(
					and(
						eq(personnelFileExpiryReminder.organizationId, organizationId),
						inArray(
							personnelFileExpiryReminder.documentId,
							due.map((reminder) => reminder.document.id),
						),
					),
				)
		).map((marker) => `${marker.documentId}:${marker.kind}:${marker.expiryDate}`),
	);

	let reminders = 0;
	let notifications = 0;
	// Claim and deliver one reminder before the next; do not fan out notification writes for a batch.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const reminder of due) {
		const { document, kind } = reminder;
		if (alreadySent.has(`${document.id}:${kind}:${document.expiryDate}`)) continue;
		// Recipients first, then the claim: a failure before the claim retries next run.
		const messages = await buildReminderMessages(database, { organizationId, now, reminder });
		const claimed = await database
			.insert(personnelFileExpiryReminder)
			.values({ organizationId, documentId: document.id, kind, expiryDate: document.expiryDate })
			.onConflictDoNothing()
			.returning({ id: personnelFileExpiryReminder.id });
		if (claimed.length === 0) continue;
		reminders += 1;
		notifications += await deliver(messages);
	}
	return { reminders, notifications };
}

async function buildReminderMessages(
	database: Database,
	input: { organizationId: string; now: Instant; reminder: DueReminder },
): Promise<CreateNotificationParams[]> {
	const { organizationId, reminder } = input;
	const { document, kind } = reminder;
	const officers = await listPersonnelFileNotificationRecipients(database, {
		organizationId,
		employeeId: document.employeeId,
		category: document.category,
		now: input.now,
	});
	const messages = officers.map((recipientUserId) =>
		buildExpiryReminderNotification({
			organizationId,
			recipientUserId,
			audience: "officer",
			kind,
			document,
		}),
	);
	// HR-only documents never reach the employee.
	if (document.visibility === "shared") {
		messages.push(
			buildExpiryReminderNotification({
				organizationId,
				recipientUserId: document.employeeUserId,
				audience: "employee",
				kind,
				document,
			}),
		);
	}
	return messages;
}

/** Sends after the claim; a failed delivery is logged, never retried (at most once). */
async function deliver(messages: CreateNotificationParams[]): Promise<number> {
	const results = await Promise.all(
		messages.map(async (message) => {
			try {
				await createNotification(message);
				return true;
			} catch (error) {
				logger.error(
					{ error, documentId: message.entityId, userId: message.userId, type: message.type },
					"Failed to deliver a personnel file expiry reminder",
				);
				return false;
			}
		}),
	);
	return results.filter(Boolean).length;
}
