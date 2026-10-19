import { and, eq, gte, inArray, isNotNull, lte, not, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { employee, employeeDocument, personnelFileExpiryReminder } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { dueExpiryReminder, type ExpiryReminderKind } from "@/lib/expiry-reminders/expiry";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { loadEmployeeSkillReminderDates } from "@/lib/scheduling/skill-expiry-reminders";
import { EXPIRY_DATE_CATEGORIES } from "./document.types";
import { buildExpiryReminderNotification, type ExpiringDocumentRef } from "./expiry-notifications";
import { loadExpiryReminderWindow } from "./expiry-store";
import { listPersonnelFileNotificationRecipients } from "./notification-recipients";
import { hasActiveRenewalRequest, isRenewedDocument } from "./renewed-documents";

/**
 * The expiry reminder job (#869), run hourly so every organization's
 * calendar day is reached soon after its midnight. For each organization
 * with personnel files on it sends, per certificate or other document with an
 * expiry date, the upcoming reminder once the document is within the lead
 * time and the expired-today reminder on the expiry date.
 *
 * Recipients: the employee if the document is shared, plus the officers
 * covering the employee and the category (owners and admins when none does).
 * A shared skill certificate expiring with its employee skill is the
 * exception (#1146): the skill reminder already tells the employee, so this
 * one goes to the officers only. Where no skill reminder reaches the employee
 * for that date (inactive skill, other date, kiosk-only employee), this one
 * still does, so the employee is reminded exactly once.
 * Renewals (#1404): while an open or submitted document request names the
 * document as its renewed document, its reminders go to the officers only
 * (read at send time, so after a cancel the employee gets the next one). A
 * renewed document (an accepted request names it) is no longer expiring and
 * gets no reminders.
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
	/**
	 * A skill certificate whose employee skill has the same expiry date and
	 * whose skill reminder reaches the employee (#1146): the employee gets that
	 * one only, the officers still get this one.
	 */
	employeeRemindedBySkill: boolean;
	/** An open or submitted document request renews it (#1404): officers only. */
	renewalRequested: boolean;
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
			employeeSkillId: employeeDocument.employeeSkillId,
			renewalRequested: hasActiveRenewalRequest(),
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
				not(isRenewedDocument()),
				employeeHasOrganizationAccess(now),
			),
		);

	// Read at send time: unlinking a certificate before a reminder is due gives the employee it back.
	const skillReminderDates = await loadEmployeeSkillReminderDates(database, {
		organizationId,
		now,
		employeeSkillIds: candidates.flatMap((row) =>
			row.visibility === "shared" && row.employeeSkillId ? [row.employeeSkillId] : [],
		),
	});

	const due: DueReminder[] = [];
	for (const row of candidates) {
		if (!row.expiryDate) continue;
		const kind = dueExpiryReminder({ today, expiryDate: row.expiryDate, leadDays });
		if (!kind) continue;
		due.push({
			employeeRemindedBySkill:
				row.employeeSkillId !== null &&
				skillReminderDates.get(row.employeeSkillId) === row.expiryDate,
			renewalRequested: row.renewalRequested === true,
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
	// HR-only documents never reach the employee; a skill certificate reaches them as its skill
	// reminder; while a document request asks for its renewal, the officers only (#1404).
	if (
		document.visibility === "shared" &&
		!reminder.employeeRemindedBySkill &&
		!reminder.renewalRequested
	) {
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
