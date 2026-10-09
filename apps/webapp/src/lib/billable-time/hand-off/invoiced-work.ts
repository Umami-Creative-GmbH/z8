import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { invoicedWork, workPeriod } from "@/db/schema";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";

/**
 * Invoiced work (#903): work periods in an unreleased invoice draft. Writers and
 * bulk actions use these readers; they never refuse a correction because work
 * is invoiced (ADR 0002), but bulk actions (#901) skip invoiced work.
 */

type Reader = Pick<Transaction, "select">;

/**
 * Set-based predicate: the `work_period` row in scope of the query is invoiced
 * work. Select it as a column or use it as a condition (`not(...)` to skip it).
 */
export function invoicedWorkPeriodSql(): SQL<boolean> {
	return sql<boolean>`exists (
		select 1 from ${invoicedWork}
		where ${invoicedWork.organizationId} = ${workPeriod.organizationId}
			and ${invoicedWork.workPeriodId} = ${workPeriod.id}
			and ${invoicedWork.releasedAt} is null
	)`;
}

/** Which of the given work periods of the organization are invoiced work. */
export async function listInvoicedWorkPeriodIds(
	reader: Reader,
	organizationId: string,
	workPeriodIds: readonly string[],
): Promise<Set<string>> {
	if (workPeriodIds.length === 0) return new Set();
	const rows = await reader
		.select({ workPeriodId: invoicedWork.workPeriodId })
		.from(invoicedWork)
		.where(
			and(
				eq(invoicedWork.organizationId, organizationId),
				inArray(invoicedWork.workPeriodId, [...workPeriodIds]),
				isNull(invoicedWork.releasedAt),
			),
		);
	return new Set(rows.map((row) => row.workPeriodId));
}

/**
 * A writer split invoiced work into two periods (split, automatic break): the
 * new period stays invoiced in the same draft, so its time is never handed off
 * twice, and is marked as changed after invoicing (`split`). The source period's
 * own change is marked by the `invoiced_work_mark_changed` trigger. Does
 * nothing when the source is not invoiced. Call it in the writer's transaction,
 * after inserting the new period.
 */
export async function carryInvoicedWorkToSplit(
	tx: Pick<Transaction, "execute">,
	input: { organizationId: string; sourceWorkPeriodId: string; newWorkPeriodId: string },
): Promise<void> {
	await tx.execute(sql`
		insert into invoiced_work (
			organization_id, invoice_draft_id, work_period_id, employee_id, project_id,
			started_at, ended_at, start_offset_minutes, duration_minutes, shares,
			carried_from_work_period_id, changed_after_invoicing_at, changed_fields
		)
		select organization_id, invoice_draft_id, ${input.newWorkPeriodId}::uuid, employee_id, project_id,
			started_at, ended_at, start_offset_minutes, duration_minutes, '[]'::jsonb,
			work_period_id, now(), array['split']::text[]
		from invoiced_work
		where organization_id = ${input.organizationId}
			and work_period_id = ${input.sourceWorkPeriodId}::uuid
			and released_at is null
		on conflict do nothing
	`);
}
