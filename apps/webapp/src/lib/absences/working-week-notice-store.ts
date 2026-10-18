import "server-only";

import { eq, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { absenceSetting, employee } from "@/db/schema";
import { logger } from "@/lib/logger";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";
import { hasZeroWorkingDaysSchedule } from "./types";
import { loadVacationBalances } from "./vacation-balance-store";
import {
	WORKING_WEEK_NOTICE_YEAR,
	type WorkingWeekNoticeRow,
	workingWeekNoticeRow,
} from "./working-week-notice";

/**
 * The one-time working-week notice of an organization (Absences ADR 0003): every employee,
 * departed ones included, whose 2026 allowance the working-week conversion reduces, with their
 * overdrawn days, and every employee whose work schedule has no working days. Worked out at read
 * time from the shared vacation balances (`loadVacationBalances`); null once an owner or admin
 * dismissed it.
 */
export async function loadWorkingWeekNotice(
	database: AbsenceDaysDatabase,
	input: { organizationId: string },
): Promise<WorkingWeekNoticeRow[] | null> {
	const { organizationId } = input;
	const [setting] = await database
		.select({ dismissedAt: absenceSetting.workingWeekNoticeDismissedAt })
		.from(absenceSetting)
		.where(eq(absenceSetting.organizationId, organizationId))
		.limit(1);
	if (setting?.dismissedAt) return null;

	const [employees, timezone] = await Promise.all([
		database
			.select({
				id: employee.id,
				name: sql<string>`COALESCE(NULLIF(concat_ws(' ', ${user.firstName}, ${user.lastName}), ''), ${user.name}, ${user.email})`,
			})
			.from(employee)
			.innerJoin(user, eq(employee.userId, user.id))
			.where(eq(employee.organizationId, organizationId)),
		loadOrganizationTimezone(database, organizationId),
	]);
	// The same balances every other reader shows.
	const { balances, configurations } = await loadVacationBalances(database, {
		organizationId,
		employeeIds: employees.map((row) => row.id),
		year: WORKING_WEEK_NOTICE_YEAR,
		timezone,
	});

	return employees
		.flatMap<WorkingWeekNoticeRow>((row) => {
			const configuration = configurations.get(row.id);
			if (configuration?.status === "conflict" && hasZeroWorkingDaysSchedule(configuration))
				return [
					{
						employeeId: row.id,
						name: row.name,
						configuration,
						referenceAllowance: null,
						convertedAllowance: null,
						overdrawnDays: null,
						allowance: null,
					},
				];
			const noticeRow = workingWeekNoticeRow({
				employeeId: row.id,
				name: row.name,
				balance: balances.get(row.id) ?? null,
			});
			return noticeRow ? [noticeRow] : [];
		})
		.toSorted((left, right) => left.name.localeCompare(right.name));
}

/**
 * The working-week notice for a settings page: a failure is logged and hides the notice instead
 * of breaking the page around it.
 */
export async function loadWorkingWeekNoticeForPage(
	database: AbsenceDaysDatabase,
	input: { organizationId: string },
): Promise<WorkingWeekNoticeRow[] | null> {
	try {
		return await loadWorkingWeekNotice(database, input);
	} catch (error) {
		logger.error(
			{ error, organizationId: input.organizationId },
			"Failed to load the working-week notice",
		);
		return null;
	}
}

/**
 * Dismisses the working-week notice for the whole organization, for good. A later dismissal keeps
 * the first one's time and owner or admin.
 */
export async function dismissWorkingWeekNotice(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; actorUserId: string },
): Promise<void> {
	await database
		.insert(absenceSetting)
		.values({
			organizationId: input.organizationId,
			workingWeekNoticeDismissedAt: sql`now()`,
			workingWeekNoticeDismissedBy: input.actorUserId,
			updatedBy: input.actorUserId,
		})
		.onConflictDoUpdate({
			target: absenceSetting.organizationId,
			set: {
				workingWeekNoticeDismissedAt: sql`COALESCE(${absenceSetting.workingWeekNoticeDismissedAt}, now())`,
				workingWeekNoticeDismissedBy: sql`CASE WHEN ${absenceSetting.workingWeekNoticeDismissedAt} IS NULL THEN ${input.actorUserId} ELSE ${absenceSetting.workingWeekNoticeDismissedBy} END`,
			},
		});
}
