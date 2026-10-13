import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { organization } from "@/db/auth-schema";
import { employee, userSettings, vehicleUseSetting } from "@/db/schema";
import type { Clock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";
import {
	type ClockingReminderTransport,
	sendDrivingDetailsReminder,
} from "@/lib/time-tracking/clocking-reminders/delivery";
import { loadRecordedOccasionKeys } from "@/lib/time-tracking/clocking-reminders/discovery";
import {
	DRIVING_DETAILS_REMINDER_DUE_DAYS,
	evaluateDrivingDetailsReminders,
} from "@/lib/time-tracking/clocking-reminders/driving-details-reminders";
import {
	type DrivingDetailsMissingWork,
	listDrivingDetailsMissing,
} from "@/lib/time-tracking/vehicle-use/driving-details-missing-store";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";

const logger = createLogger("DrivingDetailsReminders");
const ORGANIZATION_PAGE = 100;
/**
 * Work that ended this long ago can still have its reminder due: the morning after is at most
 * two days after the end in any zone, and the reminder stays due for its window after that.
 */
const LOOKBACK_HOURS = (DRIVING_DETAILS_REMINDER_DUE_DAYS + 2) * 24;

export interface DrivingDetailsRemindersResult {
	organizations: number;
	employees: number;
	/** Work periods reminded by this run (several may share one notification). */
	sent: number;
	alreadySent: number;
	failed: number;
}

export interface DrivingDetailsRemindersDeps {
	database: typeof rootDatabase;
	clock: Clock;
	transport: ClockingReminderTransport;
}

/**
 * Sends the "driving details missing" reminders due now (#1127): each flagged work period once,
 * the morning after it ended, through the clocking reminder delivery, which claims each occasion
 * once. An employee gets one reminder per morning listing all newly due work periods (#807
 * decision 8). Only organizations with vehicle use switched on are visited, so with the switch off
 * nothing is sent. Read-only over time data.
 */
export async function runDrivingDetailsRemindersWith(
	deps: DrivingDetailsRemindersDeps,
): Promise<DrivingDetailsRemindersResult> {
	const result: DrivingDetailsRemindersResult = {
		organizations: 0,
		employees: 0,
		sent: 0,
		alreadySent: 0,
		failed: 0,
	};
	let after: string | null = null;
	for (;;) {
		const organizations = await deps.database
			.select({ organizationId: vehicleUseSetting.organizationId, timezone: organization.timezone })
			.from(vehicleUseSetting)
			.innerJoin(organization, eq(organization.id, vehicleUseSetting.organizationId))
			.where(
				and(
					eq(vehicleUseSetting.enabled, true),
					isNull(organization.deletedAt),
					after ? gt(vehicleUseSetting.organizationId, after) : undefined,
				),
			)
			.orderBy(asc(vehicleUseSetting.organizationId))
			.limit(ORGANIZATION_PAGE);
		// One tenant at a time, as the clocking reminders do.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		for (const tenant of organizations) {
			result.organizations++;
			try {
				await remindOrganization(
					{
						organizationId: tenant.organizationId,
						timezone: resolveEffectiveTimezone(null, tenant.timezone),
					},
					deps,
					result,
				);
			} catch (error) {
				result.failed++;
				logger.error(
					{ err: error, organizationId: tenant.organizationId },
					"Driving details reminders for an organization failed",
				);
			}
		}
		if (organizations.length < ORGANIZATION_PAGE) break;
		after = organizations[organizations.length - 1].organizationId;
	}
	return result;
}

async function remindOrganization(
	tenant: { organizationId: string; timezone: string },
	deps: DrivingDetailsRemindersDeps,
	result: DrivingDetailsRemindersResult,
) {
	const { organizationId } = tenant;
	const now = deps.clock.nowInstant();
	const flagged = await listDrivingDetailsMissing(deps.database, {
		organizationId,
		employeeIds: null,
		endedWithin: { start: now.subtract({ hours: LOOKBACK_HOURS }), end: now },
	});
	if (flagged.length === 0) return;
	const byEmployee = new Map<string, DrivingDetailsMissingWork[]>();
	for (const work of flagged) {
		byEmployee.set(work.employeeId, [...(byEmployee.get(work.employeeId) ?? []), work]);
	}
	// Employees who can still sign in, with their own timezone, otherwise the organization's.
	const recipients = await deps.database
		.select({
			employeeId: employee.id,
			userId: employee.userId,
			userTimezone: userSettings.timezone,
		})
		.from(employee)
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(
				eq(employee.organizationId, organizationId),
				inArray(employee.id, [...byEmployee.keys()]),
				employeeHasOrganizationAccess(now),
			),
		)
		.orderBy(asc(employee.id));
	const due = recipients.map((person) => {
		const timezone = resolveEffectiveTimezone(person.userTimezone, tenant.timezone);
		return {
			recipient: { organizationId, employeeId: person.employeeId, userId: person.userId, timezone },
			reminders: evaluateDrivingDetailsReminders({
				now,
				timezone,
				work: byEmployee.get(person.employeeId) ?? [],
			}),
		};
	});
	const recorded = await loadRecordedOccasionKeys(
		{
			organizationId,
			occasionKeys: due.flatMap((entry) => entry.reminders.map((reminder) => reminder.occasionKey)),
		},
		deps.database,
	);
	// One employee at a time, bounding concurrent transport calls to one.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const { recipient, reminders } of due) {
		result.employees++;
		const unsent = reminders.filter((reminder) => !recorded.has(reminder.occasionKey));
		if (unsent.length === 0) continue;
		try {
			// One reminder per employee and morning, listing every newly due work period.
			const outcome = await sendDrivingDetailsReminder(
				{ reminders: unsent, recipient, now },
				{ database: deps.database, transport: deps.transport },
			);
			result.sent += outcome.sent;
			result.alreadySent += outcome.alreadySent;
		} catch (error) {
			result.failed++;
			logger.error(
				{ err: error, organizationId, employeeId: recipient.employeeId },
				"Driving details reminder failed",
			);
		}
	}
}
