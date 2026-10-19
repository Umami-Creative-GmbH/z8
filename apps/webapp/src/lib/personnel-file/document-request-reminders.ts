import { and, eq, inArray, lte, max, sql } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import type { db as appDb } from "@/db";
import { organization, user } from "@/db/auth-schema";
import {
	employee,
	employeeDocumentRequest,
	employeeDocumentRequestEvent,
	employeeDocumentRequestReminder,
} from "@/db/schema";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import {
	type DocumentRequestCategory,
	type DocumentRequestReminderKind,
	documentRequestEmployeeName,
} from "./document-request.types";
import { buildDocumentRequestReminderNotification } from "./document-request-notifications";
import {
	DOCUMENT_REQUEST_REMINDER_LEAD_DAYS,
	dueDocumentRequestReminder,
} from "./document-request-rules";
import { listPersonnelFileNotificationRecipients } from "./notification-recipients";
import { loadOrganizationDay, todayInOrganization } from "./organization-day";

/**
 * The document request deadline reminders (#1406, spec #1307), run hourly so
 * every organization's calendar day is reached soon after its midnight. For
 * each organization with personnel files on, each open request of a current
 * employee is reminded (`dueDocumentRequestReminder`):
 * - 3 days before its deadline and on the deadline day: the employee;
 * - on its first overdue day: the employee and the officers covering the
 *   employee and the category (owners and admins when none does).
 * Submitted requests get none; a request returned after its deadline is
 * overdue at once and gets only an overdue reminder not sent yet.
 *
 * At most once: a reminder is claimed in `employee_document_request_reminder`
 * (unique per request, kind and deadline) before anyone is notified, so a
 * rerun, a retry or a concurrent worker sends nothing again. A moved deadline
 * has no markers yet, so its reminders are armed again; markers of a deadline
 * the request no longer has are dropped, so this needs no hook in the edit.
 */

const logger = createLogger("PersonnelFileDocumentRequestReminders");

type Database = typeof appDb;

export interface DocumentRequestReminderResult {
	success: boolean;
	organizationsChecked: number;
	remindersSent: number;
	notificationsSent: number;
	errors: Array<{ organizationId: string; error: string }>;
}

interface RemindedRequest {
	id: string;
	employeeId: string;
	employeeUserId: string;
	employeeName: string;
	title: string;
	category: DocumentRequestCategory;
	/** `YYYY-MM-DD` */
	deadline: string;
}

interface DueReminder {
	kind: DocumentRequestReminderKind;
	request: RemindedRequest;
}

export async function runDocumentRequestReminders(
	database: Database,
	input: { now: Instant },
): Promise<DocumentRequestReminderResult> {
	const result: DocumentRequestReminderResult = {
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
			logger.error({ error, organizationId }, "Failed to send document request reminders");
		}
	}
	return result;
}

async function remindOrganization(
	database: Database,
	input: { organizationId: string; now: Instant },
): Promise<{ reminders: number; notifications: number }> {
	const { organizationId, now } = input;
	const { timezone, today } = await loadOrganizationDay(database, input);

	// A moved deadline re-arms the reminders, also when it moves back.
	await database.execute(sql`
		DELETE FROM ${employeeDocumentRequestReminder}
		WHERE ${employeeDocumentRequestReminder.organizationId} = ${organizationId}
		AND NOT EXISTS (
			SELECT 1 FROM ${employeeDocumentRequest}
			WHERE ${employeeDocumentRequest.id} = ${employeeDocumentRequestReminder.requestId}
			AND ${employeeDocumentRequest.organizationId} = ${organizationId}
			AND ${employeeDocumentRequest.deadline} = ${employeeDocumentRequestReminder.deadline}
		)`);

	const candidates = await database
		.select({
			id: employeeDocumentRequest.id,
			employeeId: employeeDocumentRequest.employeeId,
			employeeUserId: employee.userId,
			userName: user.name,
			employeeNumber: employee.employeeNumber,
			title: employeeDocumentRequest.title,
			category: employeeDocumentRequest.category,
			status: employeeDocumentRequest.status,
			deadline: employeeDocumentRequest.deadline,
			createdAt: employeeDocumentRequest.createdAt,
		})
		.from(employeeDocumentRequest)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeDocumentRequest.employeeId),
				eq(employee.organizationId, employeeDocumentRequest.organizationId),
			),
		)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employeeDocumentRequest.organizationId, organizationId),
				eq(employeeDocumentRequest.status, "open"),
				lte(
					employeeDocumentRequest.deadline,
					today.add({ days: DOCUMENT_REQUEST_REMINDER_LEAD_DAYS }).toString(),
				),
				employeeHasOrganizationAccess(now),
			),
		);
	if (candidates.length === 0) return { reminders: 0, notifications: 0 };

	const openedOn = await loadOpenedDays(database, {
		organizationId,
		timezone,
		requestIds: candidates.map((row) => row.id),
	});

	const due: DueReminder[] = [];
	for (const row of candidates) {
		const kind = dueDocumentRequestReminder({
			status: row.status,
			deadline: row.deadline,
			openedOn:
				openedOn.get(row.id) ?? todayInOrganization(instantFromDate(row.createdAt), timezone),
			today,
		});
		if (!kind) continue;
		due.push({
			kind,
			request: {
				id: row.id,
				employeeId: row.employeeId,
				employeeUserId: row.employeeUserId,
				employeeName: documentRequestEmployeeName(row),
				title: row.title,
				category: row.category,
				deadline: row.deadline,
			},
		});
	}
	if (due.length === 0) return { reminders: 0, notifications: 0 };

	const alreadySent = new Set(
		(
			await database
				.select({
					requestId: employeeDocumentRequestReminder.requestId,
					kind: employeeDocumentRequestReminder.kind,
					deadline: employeeDocumentRequestReminder.deadline,
				})
				.from(employeeDocumentRequestReminder)
				.where(
					and(
						eq(employeeDocumentRequestReminder.organizationId, organizationId),
						inArray(
							employeeDocumentRequestReminder.requestId,
							due.map((reminder) => reminder.request.id),
						),
					),
				)
		).map((marker) => `${marker.requestId}:${marker.kind}:${marker.deadline}`),
	);

	let reminders = 0;
	let notifications = 0;
	// Claim and deliver one reminder before the next; do not fan out notification writes for a batch.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const reminder of due) {
		const { request, kind } = reminder;
		if (alreadySent.has(`${request.id}:${kind}:${request.deadline}`)) continue;
		// Recipients first, then the claim: a failure before the claim retries next run.
		const messages = await buildReminderMessages(database, { organizationId, now, reminder });
		const claimed = await database
			.insert(employeeDocumentRequestReminder)
			.values({ organizationId, requestId: request.id, kind, deadline: request.deadline })
			.onConflictDoNothing()
			.returning({ id: employeeDocumentRequestReminder.id });
		if (claimed.length === 0) continue;
		reminders += 1;
		notifications += await deliver(messages);
	}
	return { reminders, notifications };
}

/**
 * The organization day each request was created or last returned on: that
 * day's notification names the deadline, so no day reminder follows it.
 */
async function loadOpenedDays(
	database: Database,
	input: { organizationId: string; timezone: string; requestIds: string[] },
): Promise<Map<string, Temporal.PlainDate>> {
	const rows = await database
		.select({
			requestId: employeeDocumentRequestEvent.requestId,
			openedAt: max(employeeDocumentRequestEvent.occurredAt),
		})
		.from(employeeDocumentRequestEvent)
		.where(
			and(
				eq(employeeDocumentRequestEvent.organizationId, input.organizationId),
				inArray(employeeDocumentRequestEvent.requestId, input.requestIds),
				inArray(employeeDocumentRequestEvent.kind, ["created", "returned"]),
			),
		)
		.groupBy(employeeDocumentRequestEvent.requestId);
	const days = new Map<string, Temporal.PlainDate>();
	for (const row of rows) {
		if (row.openedAt) {
			days.set(row.requestId, todayInOrganization(instantFromDate(row.openedAt), input.timezone));
		}
	}
	return days;
}

async function buildReminderMessages(
	database: Database,
	input: { organizationId: string; now: Instant; reminder: DueReminder },
): Promise<CreateNotificationParams[]> {
	const { organizationId, reminder } = input;
	const { request, kind } = reminder;
	const messages = [
		buildDocumentRequestReminderNotification({
			organizationId,
			recipientUserId: request.employeeUserId,
			audience: "employee",
			kind,
			request,
		}),
	];
	if (kind !== "overdue") return messages;
	const officers = await listPersonnelFileNotificationRecipients(database, {
		organizationId,
		employeeId: request.employeeId,
		category: request.category,
		now: input.now,
	});
	for (const recipientUserId of officers) {
		messages.push(
			buildDocumentRequestReminderNotification({
				organizationId,
				recipientUserId,
				audience: "officer",
				kind,
				request,
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
					{ error, requestId: message.entityId, userId: message.userId, type: message.type },
					"Failed to deliver a document request reminder",
				);
				return false;
			}
		}),
	);
	return results.filter(Boolean).length;
}
