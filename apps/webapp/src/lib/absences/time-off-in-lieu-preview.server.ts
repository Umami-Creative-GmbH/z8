import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import { comparePlainDates, dateFromInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { getEmployeeWorkBalance } from "@/lib/work-balance/service";
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
	const scopedEmployee = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, input.employeeId),
			eq(employee.organizationId, input.organizationId),
		),
		columns: { id: true },
		with: {
			userSettings: { columns: { timezone: true } },
			organization: { columns: { timezone: true } },
		},
	});
	if (!scopedEmployee) return null;

	const balance = await getEmployeeWorkBalance({
		employeeId: input.employeeId,
		organizationId: input.organizationId,
	});
	if (!balance) return null;

	// Only the days after the balance's last counted day can still draw on it.
	const counted = parsePlainDate(balance.computedThroughDate);
	const start = parsePlainDate(input.absence.startDate);
	const end = parsePlainDate(input.absence.endDate);
	const firstUncounted = comparePlainDates(start, counted) > 0 ? start : counted.add({ days: 1 });
	const requiredMinutesByDate: Record<string, number> = {};
	if (comparePlainDates(firstUncounted, end) <= 0) {
		const timeZone = resolveEffectiveTimezone(
			scopedEmployee.userSettings?.timezone,
			scopedEmployee.organization?.timezone,
		);
		const requirements = await getDailyWorkRequirementsForEmployee({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			startDate: dateFromInstant(firstUncounted.toZonedDateTime({ timeZone }).toInstant()),
			endDate: new Date(
				dateFromInstant(end.add({ days: 1 }).toZonedDateTime({ timeZone }).toInstant()).getTime() -
					1,
			),
			timezone: timeZone,
		});
		for (const [date, requirement] of Object.entries(requirements)) {
			requiredMinutesByDate[date] = requirement.requiredMinutes;
		}
	}

	return previewTimeOffInLieu({ balance, absence: input.absence, requiredMinutesByDate });
}
