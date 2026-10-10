import "server-only";

import { and, between, eq, inArray, isNotNull } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization, user } from "@/db/auth-schema";
import {
	absenceCategory,
	absenceDeputyReminder,
	absenceEntry,
	employee,
	userSettings,
} from "@/db/schema";
import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import {
	type AbsenceDeputyEvent,
	absenceIdsOfEvents,
	buildDeputyNotification,
	buildDeputyReminderNotification,
	type DeputyAbsenceFacts,
	isDeputyReminderDue,
	planDeputyNotices,
} from "./deputy-notifications";

/**
 * Delivers the deputy notifications of #1013: after an absence write
 * committed (`notifyAbsenceDeputies`), and the day-before reminder job
 * (`runAbsenceDeputyReminders`). Former employees are not notified.
 */

const logger = createLogger("AbsenceDeputyNotifier");

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Read after the commit: the database, or a later transaction's client. */
type Reader = Pick<Database | Transaction, "select">;

/** Names of the absent employees, by employee id, within the organization. */
async function loadAbsentNames(
	database: Reader,
	input: { organizationId: string; employeeIds: readonly string[] },
): Promise<Map<string, string>> {
	const employeeIds = [...new Set(input.employeeIds)];
	if (employeeIds.length === 0) return new Map();
	const rows = await database
		.select({ id: employee.id, name: user.name, employeeNumber: employee.employeeNumber })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(eq(employee.organizationId, input.organizationId), inArray(employee.id, employeeIds)),
		);
	return new Map(
		rows.map((row) => [row.id, row.name?.trim() || row.employeeNumber || "A colleague"]),
	);
}

/** The user ids of the deputies who still work for the organization, by employee id. */
async function loadActiveDeputyUsers(
	database: Reader,
	input: { organizationId: string; deputyEmployeeIds: readonly string[]; now?: Instant },
): Promise<Map<string, string>> {
	const deputyEmployeeIds = [...new Set(input.deputyEmployeeIds)];
	if (deputyEmployeeIds.length === 0) return new Map();
	const rows = await database
		.select({ id: employee.id, userId: employee.userId })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, deputyEmployeeIds),
				employeeHasOrganizationAccess(input.now),
			),
		);
	return new Map(rows.map((row) => [row.id, row.userId]));
}

async function loadDeputyAbsenceFacts(
	database: Reader,
	input: { organizationId: string; absenceIds: readonly string[] },
): Promise<Map<string, DeputyAbsenceFacts>> {
	if (input.absenceIds.length === 0) return new Map();
	const rows = await database
		.select({
			id: absenceEntry.id,
			employeeId: absenceEntry.employeeId,
			deputyEmployeeId: absenceEntry.deputyEmployeeId,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
			status: absenceEntry.status,
			approvedAt: absenceEntry.approvedAt,
		})
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				inArray(absenceEntry.id, [...input.absenceIds]),
			),
		);
	return new Map(
		rows.map((row) => [
			row.id,
			{
				id: row.id,
				employeeId: row.employeeId,
				deputyEmployeeId: row.deputyEmployeeId,
				startDate: row.startDate,
				endDate: row.endDate,
				status: row.status,
				wasApproved: row.status === "approved" || row.approvedAt !== null,
			},
		]),
	);
}

/**
 * Tells the deputies what committed absence writes mean for them: named,
 * removed, or new dates. Call once after the write committed, never on a
 * replay. Never throws: the write stands either way.
 */
export async function notifyAbsenceDeputies(
	database: Reader,
	input: { organizationId: string; events: readonly AbsenceDeputyEvent[] },
): Promise<void> {
	if (input.events.length === 0) return;
	try {
		const absences = await loadDeputyAbsenceFacts(database, {
			organizationId: input.organizationId,
			absenceIds: absenceIdsOfEvents(input.events),
		});
		const notices = planDeputyNotices(input.events, absences);
		if (notices.length === 0) return;
		const [names, deputies] = await Promise.all([
			loadAbsentNames(database, {
				organizationId: input.organizationId,
				employeeIds: notices.map((notice) => notice.absence.employeeId),
			}),
			loadActiveDeputyUsers(database, {
				organizationId: input.organizationId,
				deputyEmployeeIds: notices.map((notice) => notice.deputyEmployeeId),
			}),
		]);
		await Promise.all(
			notices.flatMap((notice) => {
				const recipientUserId = deputies.get(notice.deputyEmployeeId);
				if (!recipientUserId) return [];
				return [
					createNotification(
						buildDeputyNotification({
							organizationId: input.organizationId,
							recipientUserId,
							absentName: names.get(notice.absence.employeeId) ?? "A colleague",
							notice,
						}),
					),
				];
			}),
		);
	} catch (error) {
		logger.error(
			{ error, organizationId: input.organizationId, events: input.events.map((e) => e.kind) },
			"Failed to notify absence deputies",
		);
	}
}

export interface AbsenceDeputyReminderResult {
	/** Approved absences with a deputy starting within the window, before the due check. */
	candidates: number;
	sent: number;
}

/**
 * The day-before reminder (#1013): for every approved absence with a deputy
 * that starts tomorrow in the absent employee's effective timezone, tells the
 * deputy once per absence, deputy and start date. Runs hourly, so each zone
 * is reminded soon after its midnight. The marker is claimed before
 * notifying, so the reminder is sent at most once even with in-app off.
 */
export async function runAbsenceDeputyReminders(
	database: Database,
	input: { now: Instant },
): Promise<AbsenceDeputyReminderResult> {
	// Tomorrow anywhere (UTC-12 to UTC+14) is between today and the day after tomorrow in UTC.
	const utcToday = plainDateAt(input.now, "UTC");
	const rows = await database
		.select({
			id: absenceEntry.id,
			organizationId: absenceEntry.organizationId,
			employeeId: absenceEntry.employeeId,
			deputyEmployeeId: absenceEntry.deputyEmployeeId,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
			userTimezone: userSettings.timezone,
			organizationTimezone: organization.timezone,
		})
		.from(absenceEntry)
		.innerJoin(
			absenceCategory,
			and(
				eq(absenceCategory.id, absenceEntry.categoryId),
				eq(absenceCategory.organizationId, absenceEntry.organizationId),
			),
		)
		.innerJoin(organization, eq(organization.id, absenceEntry.organizationId))
		.innerJoin(
			employee,
			and(
				eq(employee.id, absenceEntry.employeeId),
				eq(employee.organizationId, absenceEntry.organizationId),
			),
		)
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(
				eq(absenceEntry.status, "approved"),
				isNotNull(absenceEntry.deputyEmployeeId),
				between(absenceEntry.startDate, utcToday.toString(), utcToday.add({ days: 2 }).toString()),
			),
		);

	const due = rows.filter(
		(row) =>
			row.organizationId !== null &&
			row.deputyEmployeeId !== null &&
			isDeputyReminderDue({
				startDate: row.startDate,
				timezone: resolveEffectiveTimezone(
					row.userTimezone ?? undefined,
					row.organizationTimezone ?? undefined,
				),
				now: input.now,
			}),
	);

	let sent = 0;
	const byOrganization = new Map<string, typeof due>();
	for (const row of due) {
		const organizationId = row.organizationId as string;
		byOrganization.set(organizationId, [...(byOrganization.get(organizationId) ?? []), row]);
	}
	for (const [organizationId, absences] of byOrganization) {
		try {
			const [names, deputies] = await Promise.all([
				loadAbsentNames(database, {
					organizationId,
					employeeIds: absences.map((absence) => absence.employeeId),
				}),
				loadActiveDeputyUsers(database, {
					organizationId,
					deputyEmployeeIds: absences.map((absence) => absence.deputyEmployeeId as string),
					now: input.now,
				}),
			]);
			for (const absence of absences) {
				const deputyEmployeeId = absence.deputyEmployeeId as string;
				const recipientUserId = deputies.get(deputyEmployeeId);
				if (!recipientUserId) continue;
				const [claimed] = await database
					.insert(absenceDeputyReminder)
					.values({
						organizationId,
						absenceId: absence.id,
						deputyEmployeeId,
						startDate: absence.startDate,
					})
					.onConflictDoNothing()
					.returning({ id: absenceDeputyReminder.id });
				if (!claimed) continue;
				await createNotification(
					buildDeputyReminderNotification({
						organizationId,
						recipientUserId,
						absentName: names.get(absence.employeeId) ?? "A colleague",
						absence,
						deputyEmployeeId,
					}),
				);
				sent += 1;
			}
		} catch (error) {
			logger.error({ error, organizationId }, "Failed to send absence deputy reminders");
		}
	}
	return { candidates: rows.length, sent };
}
