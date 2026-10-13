import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, employeeSkill, skill, skillExpiryReminder } from "@/db/schema";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { dueExpiryReminder, type ExpiryReminderKind } from "@/lib/expiry-reminders/expiry";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import {
	buildSkillExpiryReminderNotification,
	type ExpiringEmployeeSkillRef,
} from "./skill-expiry-notifications";
import { listSkillReminderManagers } from "./skill-reminder-recipients";
import { loadSkillReminderWindow } from "./skill-reminder-store";

/**
 * The skill expiry reminder job (#1143), run hourly so every organization's
 * calendar day is reached soon after its midnight. For each organization with
 * skills it sends, per employee skill with a skill expiry date, the "expires
 * soon" reminder once the date is within the skill reminder lead time and the
 * "expires today" reminder on the date (the last valid day).
 *
 * Recipients: the employee and their managers, or the owners and admins when
 * the employee has no manager. Former employees and inactive skills get none.
 *
 * At most once: a reminder is claimed in `skill_expiry_reminder` (unique per
 * employee skill, kind and skill expiry date) before anyone is notified, so a
 * second run, a retry or a concurrent worker sends nothing again. Modelled on
 * the personnel file expiry reminders (#869).
 */

const logger = createLogger("SkillExpiryReminders");

type Database = typeof appDb;

export interface SkillExpiryReminderResult {
	success: boolean;
	organizationsChecked: number;
	remindersSent: number;
	notificationsSent: number;
	errors: Array<{ organizationId: string; error: string }>;
}

interface DueReminder {
	kind: ExpiryReminderKind;
	employeeSkill: ExpiringEmployeeSkillRef & { employeeUserId: string; employeeEmail: string };
}

export async function runSkillExpiryReminders(
	database: Database,
	input: { now: Instant },
): Promise<SkillExpiryReminderResult> {
	const result: SkillExpiryReminderResult = {
		success: true,
		organizationsChecked: 0,
		remindersSent: 0,
		notificationsSent: 0,
		errors: [],
	};
	// Only organizations with a skill catalog can have employee skills or markers.
	const organizations = await database
		.selectDistinct({ id: skill.organizationId })
		.from(skill)
		.orderBy(skill.organizationId);

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
			logger.error({ error, organizationId }, "Failed to send skill expiry reminders");
		}
	}
	return result;
}

async function remindOrganization(
	database: Database,
	input: { organizationId: string; now: Instant },
): Promise<{ reminders: number; notifications: number }> {
	const { organizationId, now } = input;
	const { today, leadDays, windowEnd } = await loadSkillReminderWindow(database, input);

	// A moved (or cleared) skill expiry date re-arms both reminders, also when it moves back.
	await database.execute(sql`
		DELETE FROM ${skillExpiryReminder}
		WHERE ${skillExpiryReminder.organizationId} = ${organizationId}
		AND NOT EXISTS (
			SELECT 1 FROM ${employeeSkill}
			WHERE ${employeeSkill.id} = ${skillExpiryReminder.employeeSkillId}
			AND ${employeeSkill.employeeId} = ${skillExpiryReminder.employeeId}
			AND ${employeeSkill.expiresAt} = ${skillExpiryReminder.expiryDate}
		)`);

	// `employeeSkill` has no organization: both its employee and its skill must be the organization's.
	const candidates = await database
		.select({
			id: employeeSkill.id,
			employeeId: employeeSkill.employeeId,
			employeeUserId: employee.userId,
			userName: user.name,
			userEmail: user.email,
			employeeNumber: employee.employeeNumber,
			skillName: skill.name,
			expiryDate: employeeSkill.expiresAt,
		})
		.from(employeeSkill)
		.innerJoin(
			employee,
			and(eq(employee.id, employeeSkill.employeeId), eq(employee.organizationId, organizationId)),
		)
		.innerJoin(
			skill,
			and(
				eq(skill.id, employeeSkill.skillId),
				eq(skill.organizationId, organizationId),
				eq(skill.isActive, true),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				isNotNull(employeeSkill.expiresAt),
				gte(employeeSkill.expiresAt, today),
				lte(employeeSkill.expiresAt, windowEnd),
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
			employeeSkill: {
				id: row.id,
				employeeId: row.employeeId,
				employeeUserId: row.employeeUserId,
				employeeEmail: row.userEmail,
				employeeName: row.userName?.trim() || row.employeeNumber || row.employeeId,
				skillName: row.skillName,
				expiryDate: row.expiryDate,
			},
		});
	}
	if (due.length === 0) return { reminders: 0, notifications: 0 };

	const alreadySent = new Set(
		(
			await database
				.select({
					employeeSkillId: skillExpiryReminder.employeeSkillId,
					kind: skillExpiryReminder.kind,
					expiryDate: skillExpiryReminder.expiryDate,
				})
				.from(skillExpiryReminder)
				.where(
					and(
						eq(skillExpiryReminder.organizationId, organizationId),
						inArray(
							skillExpiryReminder.employeeSkillId,
							due.map((reminder) => reminder.employeeSkill.id),
						),
					),
				)
		).map((marker) => `${marker.employeeSkillId}:${marker.kind}:${marker.expiryDate}`),
	);

	let reminders = 0;
	let notifications = 0;
	// Claim and deliver one reminder before the next; do not fan out notification writes for a batch.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const reminder of due) {
		const { employeeSkill: expiring, kind } = reminder;
		if (alreadySent.has(`${expiring.id}:${kind}:${expiring.expiryDate}`)) continue;
		// Recipients first, then the claim: a failure before the claim retries next run.
		const messages = await buildReminderMessages(database, { organizationId, now, reminder });
		const claimed = await database
			.insert(skillExpiryReminder)
			.values({
				organizationId,
				employeeId: expiring.employeeId,
				employeeSkillId: expiring.id,
				kind,
				expiryDate: expiring.expiryDate,
			})
			.onConflictDoNothing()
			.returning({ id: skillExpiryReminder.id });
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
	const { employeeSkill: expiring, kind } = reminder;
	const managers = await listSkillReminderManagers(database, {
		organizationId,
		employeeId: expiring.employeeId,
		employeeUserId: expiring.employeeUserId,
		now: input.now,
	});
	const messages = managers.map((recipientUserId) =>
		buildSkillExpiryReminderNotification({
			organizationId,
			recipientUserId,
			audience: "manager",
			kind,
			employeeSkill: expiring,
		}),
	);
	// A kiosk-only employee cannot read notifications; their managers (or admins) already are told.
	if (!isReservedEmail(expiring.employeeEmail)) {
		messages.push(
			buildSkillExpiryReminderNotification({
				organizationId,
				recipientUserId: expiring.employeeUserId,
				audience: "employee",
				kind,
				employeeSkill: expiring,
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
					{ error, employeeSkillId: message.entityId, userId: message.userId, type: message.type },
					"Failed to deliver a skill expiry reminder",
				);
				return false;
			}
		}),
	);
	return results.filter(Boolean).length;
}
