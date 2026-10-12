import "server-only";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { comparePlainDates, dateFromInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { getEmployeeWorkBalance, loadWorkBalanceEmployee } from "@/lib/work-balance/service";
import {
	previewTimeOffInLieu,
	type TimeOffInLieuAbsence,
	type TimeOffInLieuPreview,
} from "./time-off-in-lieu-preview";

/**
 * The projected work balance after an absence that draws on it, for the employee who
 * requests it and the approver who decides it (#1000). Null while the employee's work
 * balance is unavailable, such as during a rebuild, or when the employee is not in the
 * organization.
 */
export async function loadTimeOffInLieuPreview(input: {
	organizationId: string;
	employeeId: string;
	absence: TimeOffInLieuAbsence;
}): Promise<TimeOffInLieuPreview | null> {
	const scope = { organizationId: input.organizationId, employeeId: input.employeeId };
	const subject = await loadWorkBalanceEmployee(scope);
	if (!subject) return null;

	const balance = await getEmployeeWorkBalance(scope);
	if (!balance) return null;

	// Only the days after the balance's last counted day can still draw on it.
	const counted = parsePlainDate(balance.computedThroughDate);
	const start = parsePlainDate(input.absence.startDate);
	const end = parsePlainDate(input.absence.endDate);
	const firstUncounted = comparePlainDates(start, counted) > 0 ? start : counted.add({ days: 1 });
	const requiredMinutesByDate: Record<string, number> = {};
	if (comparePlainDates(firstUncounted, end) <= 0) {
		// From the start of the first uncounted day through the last instant of the
		// absence's last day, in the employee's timezone.
		const requirements = await getDailyWorkRequirementsForEmployee({
			...scope,
			startDate: dateFromInstant(localDayRange(firstUncounted.toString(), subject.timezone).start),
			endDate: dateFromInstant(
				localDayRange(end.toString(), subject.timezone).endExclusive.subtract({ milliseconds: 1 }),
			),
			timezone: subject.timezone,
		});
		for (const [date, requirement] of Object.entries(requirements)) {
			requiredMinutesByDate[date] = requirement.requiredMinutes;
		}
	}

	return previewTimeOffInLieu({ balance, absence: input.absence, requiredMinutesByDate });
}
