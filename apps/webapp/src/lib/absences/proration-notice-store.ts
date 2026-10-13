import "server-only";

import { eq, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { absenceSetting, employee } from "@/db/schema";
import { logger } from "@/lib/logger";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";
import {
	PRORATION_NOTICE_YEAR,
	type ProrationNoticeRow,
	prorationNoticeRow,
} from "./proration-notice";
import { loadVacationBalances } from "./vacation-balance-store";

/**
 * The one-time proration notice of an organization (#1112): every employee, departed ones
 * included, whose 2026 allowance is now prorated below the full allowance, with their overdrawn
 * days. Worked out at read time from the shared vacation balances (`loadVacationBalances`), all
 * read through `database`; null once an owner or admin dismissed it.
 */
export async function loadProrationNotice(
	database: AbsenceDaysDatabase,
	input: { organizationId: string },
): Promise<ProrationNoticeRow[] | null> {
	const { organizationId } = input;
	const [setting] = await database
		.select({ dismissedAt: absenceSetting.prorationNoticeDismissedAt })
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
	const { balances } = await loadVacationBalances(database, {
		organizationId,
		employeeIds: employees.map((row) => row.id),
		year: PRORATION_NOTICE_YEAR,
		timezone,
	});

	return employees
		.flatMap((row) => {
			const noticeRow = prorationNoticeRow({
				employeeId: row.id,
				name: row.name,
				balance: balances.get(row.id) ?? null,
			});
			return noticeRow ? [noticeRow] : [];
		})
		.toSorted((left, right) => left.name.localeCompare(right.name));
}

/**
 * The proration notice for a settings page: a failure is logged and hides the notice instead of
 * breaking the page around it.
 */
export async function loadProrationNoticeForPage(
	database: AbsenceDaysDatabase,
	input: { organizationId: string },
): Promise<ProrationNoticeRow[] | null> {
	try {
		return await loadProrationNotice(database, input);
	} catch (error) {
		logger.error(
			{ error, organizationId: input.organizationId },
			"Failed to load the proration notice",
		);
		return null;
	}
}

/**
 * Dismisses the proration notice for the whole organization, for good. A later dismissal keeps
 * the first one's time and owner or admin.
 */
export async function dismissProrationNotice(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; actorUserId: string },
): Promise<void> {
	await database
		.insert(absenceSetting)
		.values({
			organizationId: input.organizationId,
			prorationNoticeDismissedAt: sql`now()`,
			prorationNoticeDismissedBy: input.actorUserId,
			updatedBy: input.actorUserId,
		})
		.onConflictDoUpdate({
			target: absenceSetting.organizationId,
			set: {
				prorationNoticeDismissedAt: sql`COALESCE(${absenceSetting.prorationNoticeDismissedAt}, now())`,
				prorationNoticeDismissedBy: sql`CASE WHEN ${absenceSetting.prorationNoticeDismissedAt} IS NULL THEN ${input.actorUserId} ELSE ${absenceSetting.prorationNoticeDismissedBy} END`,
			},
		});
}
