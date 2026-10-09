import type { db as rootDatabase } from "@/db";
import { type Clock, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import type { BreakDueRegulation } from "@/lib/time-tracking/break-due";
import {
	type BreakDueFacts,
	loadBreakDueFacts,
} from "@/lib/time-tracking/clocking-reminders/break-due-discovery";
import { evaluateBreakDueReminders } from "@/lib/time-tracking/clocking-reminders/break-due-reminders";
import {
	type ClockingReminderTransport,
	sendClockingReminder,
} from "@/lib/time-tracking/clocking-reminders/delivery";
import {
	type ClockingReminderEmployee,
	type ClockingReminderOrganization,
	listClockingReminderEmployees,
	listClockingReminderOrganizations,
	loadShiftReminderFacts,
} from "@/lib/time-tracking/clocking-reminders/discovery";
import {
	loadApprovedAbsenceDays,
	loadHolidayDays,
} from "@/lib/time-tracking/clocking-reminders/exemptions";
import {
	type DueClockingReminder,
	isExemptOnAbsenceOrHoliday,
} from "@/lib/time-tracking/clocking-reminders/occasion";
import { evaluateShiftReminders } from "@/lib/time-tracking/clocking-reminders/shift-reminders";

const logger = createLogger("ClockingReminders");
const ORGANIZATION_PAGE = 100;
const EMPLOYEE_PAGE = 200;

export interface ClockingRemindersResult {
	organizations: number;
	employees: number;
	sent: number;
	alreadySent: number;
	failed: number;
}

interface ClockingRemindersDeps {
	database: typeof rootDatabase;
	clock: Clock;
	transport: ClockingReminderTransport;
	holidayDays: typeof loadHolidayDays;
	/** The break rules of the employee's effective work policy at `at`; `null` without one. */
	breakRegulation(input: {
		organizationId: string;
		employeeId: string;
		at: Instant;
	}): Promise<BreakDueRegulation | null>;
}

/**
 * Sends the clocking reminders due now. Read-only over time data: it never writes work records
 * or opens a work transaction. Overlapping runs are safe because each occasion is claimed once.
 */
export async function runClockingRemindersWith(
	deps: ClockingRemindersDeps,
): Promise<ClockingRemindersResult> {
	const result: ClockingRemindersResult = {
		organizations: 0,
		employees: 0,
		sent: 0,
		alreadySent: 0,
		failed: 0,
	};
	let afterOrganization: string | null = null;
	for (;;) {
		const organizations = await listClockingReminderOrganizations(
			{ after: afterOrganization, limit: ORGANIZATION_PAGE },
			deps.database,
		);
		for (const organization of organizations) {
			result.organizations++;
			try {
				await remindOrganization(organization, deps, result);
			} catch (error) {
				result.failed++;
				logger.error(
					{ err: error, organizationId: organization.organizationId },
					"Clocking reminders for an organization failed",
				);
			}
		}
		if (organizations.length < ORGANIZATION_PAGE) break;
		afterOrganization = organizations[organizations.length - 1].organizationId;
	}
	logger.info(result, "Clocking reminders completed");
	return result;
}

async function remindOrganization(
	organization: ClockingReminderOrganization,
	deps: ClockingRemindersDeps,
	result: ClockingRemindersResult,
) {
	let after: string | null = null;
	for (;;) {
		const now = deps.clock.nowInstant();
		const employees = await listClockingReminderEmployees(
			{ organization, roles: organization.settings.roles, now, after, limit: EMPLOYEE_PAGE },
			deps.database,
		);
		const facts = await loadShiftReminderFacts(
			{
				organizationId: organization.organizationId,
				employeeIds: employees.map((person) => person.employeeId),
				now,
			},
			deps.database,
		);
		const breakFacts = organization.settings.breakDue.enabled
			? await loadBreakDueFacts(
					{ organizationId: organization.organizationId, employees },
					deps.database,
				)
			: new Map<string, BreakDueFacts>();
		for (const person of employees) {
			result.employees++;
			const personFacts = facts.get(person.employeeId);
			if (!personFacts) continue;
			try {
				const due = evaluateShiftReminders({
					now,
					employeeId: person.employeeId,
					timezone: person.timezone,
					organizationTimezone: organization.timezone,
					settings: organization.settings,
					...personFacts,
				});
				const live = breakFacts.get(person.employeeId);
				if (live) {
					const regulation = await deps.breakRegulation({
						organizationId: organization.organizationId,
						employeeId: person.employeeId,
						at: now,
					});
					due.push(
						...evaluateBreakDueReminders({
							now,
							timezone: person.timezone,
							settings: organization.settings,
							regulation,
							...live,
						}),
					);
				}
				for (const reminder of await withoutExemptDays(organization, person, due, deps)) {
					const outcome = await sendClockingReminder(
						{
							reminder,
							recipient: { organizationId: organization.organizationId, ...person },
							now,
						},
						{ database: deps.database, transport: deps.transport },
					);
					if (outcome === "sent") result.sent++;
					else result.alreadySent++;
				}
			} catch (error) {
				result.failed++;
				logger.error(
					{
						err: error,
						organizationId: organization.organizationId,
						employeeId: person.employeeId,
					},
					"Clocking reminder for an employee failed",
				);
			}
		}
		if (employees.length < EMPLOYEE_PAGE) return;
		after = employees[employees.length - 1].employeeId;
	}
}

/** Drops reminders exempt on the employee's approved absence or holiday days. */
async function withoutExemptDays(
	organization: ClockingReminderOrganization,
	person: ClockingReminderEmployee,
	due: DueClockingReminder[],
	deps: ClockingRemindersDeps,
): Promise<DueClockingReminder[]> {
	const days = [
		...new Set(
			due.filter((reminder) => isExemptOnAbsenceOrHoliday(reminder.type)).map((r) => r.day),
		),
	];
	if (days.length === 0) return due;
	const scope = {
		organizationId: organization.organizationId,
		employeeId: person.employeeId,
		days,
	};
	const [absent, holidays] = await Promise.all([
		loadApprovedAbsenceDays(scope, deps.database),
		deps.holidayDays(scope),
	]);
	return due.filter(
		(reminder) =>
			!isExemptOnAbsenceOrHoliday(reminder.type) ||
			(!absent.has(reminder.day) && !holidays.has(reminder.day)),
	);
}

/** The regulation of the work policy in force for the employee at `at`. */
async function loadBreakRegulation(input: {
	organizationId: string;
	employeeId: string;
	at: Instant;
}): Promise<BreakDueRegulation | null> {
	const [{ Effect }, { runtime }, { WorkPolicyService }] = await Promise.all([
		import("effect"),
		import("@/lib/effect/runtime"),
		import("@/lib/effect/services/work-policy.service"),
	]);
	const policy = await runtime.runPromise(
		Effect.gen(function* () {
			const service = yield* WorkPolicyService;
			return yield* service.getEffectivePolicyAt(input);
		}),
	);
	return policy?.regulation ?? null;
}

/** Production wiring; tests pass their own database and clock. */
export async function runClockingReminders(
	overrides: { database?: typeof rootDatabase; clock?: Clock } = {},
): Promise<ClockingRemindersResult> {
	const [
		{ db },
		service,
		{ resolveRecipientNotificationLocale },
		{ localizeOutboundNotification },
	] = await Promise.all([
		import("@/db"),
		import("@/lib/notifications/notification-service"),
		import("@/lib/notifications/recipient-locale"),
		import("@/lib/notifications/outbound-localization"),
	]);
	return runClockingRemindersWith({
		database: overrides.database ?? db,
		clock: overrides.clock ?? systemClock,
		holidayDays: loadHolidayDays,
		breakRegulation: loadBreakRegulation,
		transport: {
			locale: resolveRecipientNotificationLocale,
			notify: async (params, locale) => {
				// Push and bots carry the stored text, so render it in the recipient's locale.
				const localized = await localizeOutboundNotification({ ...params, locale });
				await service.createNotification(
					{ ...params, title: localized.title, message: localized.message },
					{ throwOnError: true },
				);
			},
		},
	});
}
