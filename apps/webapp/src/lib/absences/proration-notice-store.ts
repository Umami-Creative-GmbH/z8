import "server-only";

import { eq, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { absenceSetting, employee } from "@/db/schema";
import { logger } from "@/lib/logger";
import { getVacationAllowance } from "@/lib/query/vacation.queries";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";
import { loadProratedVacationAllowances } from "./prorated-allowance-store";
import {
	PRORATION_NOTICE_YEAR,
	type ProrationNoticeRow,
	prorationNoticeRow,
} from "./proration-notice";
import { getEnhancedVacationBalance } from "./vacation.service";

/** Balances are read a few at a time so a large organization does not exhaust the pool. */
const BALANCE_CONCURRENCY = 8;

/**
 * The one-time proration notice of an organization (#1112): every employee, departed ones
 * included, whose 2026 allowance is now prorated below the full allowance, with their overdrawn
 * days. Worked out at read time from the shared allowance and balance; null once an owner or
 * admin dismissed it.
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

	const year = PRORATION_NOTICE_YEAR;
	const policy = await getVacationAllowance(organizationId, year);
	if (!policy) return [];

	const employees = await database
		.select({
			id: employee.id,
			name: sql<string>`COALESCE(NULLIF(concat_ws(' ', ${user.firstName}, ${user.lastName}), ''), ${user.name}, ${user.email})`,
		})
		.from(employee)
		.innerJoin(user, eq(employee.userId, user.id))
		.where(eq(employee.organizationId, organizationId));
	const allowances = await loadProratedVacationAllowances(database, {
		organizationId,
		employeeIds: employees.map((row) => row.id),
		year,
		policy,
	});
	// Only a prorated allowance can have dropped; the balance then confirms it with the same
	// numbers every balance reader shows.
	const candidates = employees.filter((row) => {
		const allowance = allowances.get(row.id);
		return allowance?.reason.kind === "prorated" && allowance.allowance < allowance.fullAllowance;
	});
	if (candidates.length === 0) return [];

	const timezone = await loadOrganizationTimezone(database, organizationId);
	const rows: ProrationNoticeRow[] = [];
	for (let index = 0; index < candidates.length; index += BALANCE_CONCURRENCY) {
		const batch = candidates.slice(index, index + BALANCE_CONCURRENCY);
		const balances = await Promise.all(
			batch.map((row) => getEnhancedVacationBalance({ employeeId: row.id, year, timezone })),
		);
		batch.forEach((row, position) => {
			const noticeRow = prorationNoticeRow({
				employeeId: row.id,
				name: row.name,
				balance: balances[position] ?? null,
			});
			if (noticeRow) rows.push(noticeRow);
		});
	}
	return rows.toSorted((left, right) => left.name.localeCompare(right.name));
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
