import type { db as rootDatabase } from "@/db";
import { type Clock, plainDateAt } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	type ClockingReminderTransport,
	sendClockingReminder,
} from "@/lib/time-tracking/clocking-reminders/delivery";
import {
	type ClockingReminderEmployee,
	listClockingReminderEmployees,
	loadRecordedOccasionKeys,
} from "@/lib/time-tracking/clocking-reminders/discovery";
import type { DueClockingReminder } from "@/lib/time-tracking/clocking-reminders/occasion";
import {
	listPeriodSubmissionReminderOrganizations,
	loadSubmittedPeriodEndDates,
	type PeriodSubmissionReminderOrganization,
} from "@/lib/time-tracking/clocking-reminders/period-submission-discovery";
import {
	evaluatePeriodSubmissionReminders,
	PERIOD_SUBMISSION_REMINDER_DUE_DAYS,
} from "@/lib/time-tracking/clocking-reminders/period-submission-reminders";
import { scheduledSubmissionPeriods } from "@/lib/time-tracking/period-submissions/cadence";
import { loadExpectedSubmissionPeriodFacts } from "@/lib/time-tracking/period-submissions/employee-expected-periods";
import { deriveExpectedSubmissionPeriods } from "@/lib/time-tracking/period-submissions/expected-periods";
import {
	loadPeriodSubmissionSettings,
	loadSubmissionCadenceHistory,
} from "@/lib/time-tracking/period-submissions/settings";

const logger = createLogger("PeriodSubmissionReminders");
const ORGANIZATION_PAGE = 100;
const EMPLOYEE_PAGE = 200;

export interface PeriodSubmissionRemindersResult {
	organizations: number;
	employees: number;
	sent: number;
	alreadySent: number;
	failed: number;
}

export interface PeriodSubmissionRemindersDeps {
	database: typeof rootDatabase;
	clock: Clock;
	transport: ClockingReminderTransport;
}

/**
 * Sends the period submission reminders due now (#1064) through the clocking reminder delivery,
 * which claims each occasion once. Read-only over time and submission data.
 *
 * Cheap checks run first for a page of employees: the organization's cadence alone says which
 * periods could have a reminder due, and reminders already sent or periods already submitted are
 * dropped in one query each. Only then are an employee's expected periods derived (employment,
 * absences, holidays, schedule), and the reminders evaluated against them.
 */
export async function runPeriodSubmissionRemindersWith(
	deps: PeriodSubmissionRemindersDeps,
): Promise<PeriodSubmissionRemindersResult> {
	const result: PeriodSubmissionRemindersResult = {
		organizations: 0,
		employees: 0,
		sent: 0,
		alreadySent: 0,
		failed: 0,
	};
	let afterOrganization: string | null = null;
	for (;;) {
		const organizations = await listPeriodSubmissionReminderOrganizations(
			{ after: afterOrganization, limit: ORGANIZATION_PAGE },
			deps.database,
		);
		// One tenant at a time, as the clocking reminders do.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		for (const organization of organizations) {
			result.organizations++;
			try {
				await remindOrganization(organization, deps, result);
			} catch (error) {
				result.failed++;
				logger.error(
					{ err: error, organizationId: organization.organizationId },
					"Period submission reminders for an organization failed",
				);
			}
		}
		if (organizations.length < ORGANIZATION_PAGE) break;
		afterOrganization = organizations[organizations.length - 1].organizationId;
	}
	return result;
}

async function remindOrganization(
	organization: PeriodSubmissionReminderOrganization,
	deps: PeriodSubmissionRemindersDeps,
	result: PeriodSubmissionRemindersResult,
) {
	const { organizationId } = organization;
	const [history, settings] = await Promise.all([
		loadSubmissionCadenceHistory(deps.database, organizationId),
		loadPeriodSubmissionSettings(deps.database, organizationId, { clock: deps.clock }),
	]);
	const delayDays = settings.secondReminderDelayDays;
	let after: string | null = null;
	for (;;) {
		const now = deps.clock.nowInstant();
		// Periods whose second reminder can still be due end at most this many days ago; a day of
		// margin each side covers every timezone.
		const utcToday = plainDateAt(now, "UTC");
		const window = {
			from: utcToday.subtract({ days: delayDays + PERIOD_SUBMISSION_REMINDER_DUE_DAYS + 2 }),
			to: utcToday.add({ days: 1 }),
		};
		const employees = await listClockingReminderEmployees(
			{ organization, roles: null, now, after, limit: EMPLOYEE_PAGE },
			deps.database,
		);
		const evaluate = (
			person: ClockingReminderEmployee,
			periods: Parameters<typeof evaluatePeriodSubmissionReminders>[0]["periods"],
			submittedEndDates: ReadonlySet<string>,
		) =>
			evaluatePeriodSubmissionReminders({
				now,
				employeeId: person.employeeId,
				periods,
				submittedEndDates,
				secondReminderDelayDays: delayDays,
			});
		// Candidates from the cadence alone: expected periods are a subset with the same last days.
		const candidates = new Map<string, DueClockingReminder[]>();
		for (const person of employees) {
			const scheduled = scheduledSubmissionPeriods(history, person.timezone, window).map(
				(period) => ({ ...period, timezone: person.timezone }),
			);
			const due = evaluate(person, scheduled, new Set());
			if (due.length > 0) candidates.set(person.employeeId, due);
		}
		const all = [...candidates.values()].flat();
		const [recorded, submitted] = await Promise.all([
			loadRecordedOccasionKeys(
				{ organizationId, occasionKeys: all.map((reminder) => reminder.occasionKey) },
				deps.database,
			),
			loadSubmittedPeriodEndDates(
				{
					organizationId,
					employeeIds: [...candidates.keys()],
					endDates: [...new Set(all.map((reminder) => reminder.day.toString()))],
				},
				deps.database,
			),
		]);
		for (const person of employees) {
			result.employees++;
			const submittedEndDates = submitted.get(person.employeeId) ?? new Set<string>();
			const open = (candidates.get(person.employeeId) ?? []).filter(
				(reminder) =>
					!recorded.has(reminder.occasionKey) && !submittedEndDates.has(reminder.day.toString()),
			);
			if (open.length === 0) continue;
			try {
				const facts = await loadExpectedSubmissionPeriodFacts(deps.database, {
					organizationId,
					employeeId: person.employeeId,
					window,
				});
				if (!facts) continue;
				const due = evaluate(
					person,
					deriveExpectedSubmissionPeriods(facts, window),
					submittedEndDates,
				).filter((reminder) => !recorded.has(reminder.occasionKey));
				// Preserve delivery order for this employee and bound concurrent transport calls to one.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				for (const reminder of due) {
					const outcome = await sendClockingReminder(
						{ reminder, recipient: { organizationId, ...person }, now },
						{ database: deps.database, transport: deps.transport },
					);
					if (outcome === "sent") result.sent++;
					else result.alreadySent++;
				}
			} catch (error) {
				result.failed++;
				logger.error(
					{ err: error, organizationId, employeeId: person.employeeId },
					"Period submission reminder for an employee failed",
				);
			}
		}
		if (employees.length < EMPLOYEE_PAGE) return;
		after = employees[employees.length - 1].employeeId;
	}
}
