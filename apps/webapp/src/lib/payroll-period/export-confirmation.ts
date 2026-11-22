import "server-only";

import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { payrollExportCarriedDay, payrollExportJob, payrollSettledDay } from "@/db/schema";
import { hasActivePayrollAccessGrant } from "@/lib/payroll-access/permissions";
import { loadExportCarriedDays, type PayrollCarriedDay } from "./carried-days";
import { resolvePeriodEmployeeIds } from "./read-period";
import {
	insertSettlements,
	type PayrollDayKey,
	type PayrollSettlementActor,
	planDays,
	type SettleDaysPlan,
} from "./settlement";

/**
 * Confirming a payroll export as paid (#1899, payroll-export ADR 0004): settles exactly
 * the employee-days the completed file carried, with the values it carried, linked to
 * the export. Organization-scoped; every employee the file carried must be in the
 * actor's payroll access grant, otherwise nothing is settled.
 */

export type ConfirmExportRejection =
	/** No such export in the organization. */
	| { status: "not_found" }
	/** The export is pending, processing or failed. */
	| { status: "not_completed" }
	/** The export recorded no carried days: an API delivery or a file made before #1899. */
	| { status: "nothing_carried" }
	/** The file carried employees outside the grant; nothing was settled. */
	| { status: "out_of_scope"; employeeIds: string[] };

/** A confirmation's plan: a settle plan plus the days it skips because they were unsettled. */
export interface ConfirmExportPlan extends SettleDaysPlan {
	/**
	 * Days this export settled before and someone unsettled since: confirming again
	 * never settles them anew. They can be settled by hand.
	 */
	previouslyUnsettled: PayrollDayKey[];
}

export type ConfirmExportPreview =
	| ConfirmExportRejection
	| ({ status: "ready" } & ConfirmExportPlan);
export type ConfirmExportResult =
	| ConfirmExportRejection
	| ({ status: "settled" } & ConfirmExportPlan);

/** A completed export the actor may confirm as paid, with its settlement progress. */
export interface PayrollExportToConfirm {
	jobId: string;
	fileName: string | null;
	/** Inclusive logical dates of the export. */
	startDate: string;
	endDate: string;
	/** ISO instant. */
	completedAt: string | null;
	employeeCount: number;
	/** Employee-days the file carried. */
	carriedDays: number;
	/** Of those, the days settled now (by this export or otherwise). */
	settledDays: number;
	/** Settled and changed-since-settled days the file left out (#1898). */
	settledDaysLeftOut: number;
	/** The file was reissued with its settled days (#1898). */
	includesSettledDays: boolean;
}

/** What confirming the export as paid would settle, without settling anything. */
export async function previewConfirmExportAsPaid(
	organizationId: string,
	actor: PayrollSettlementActor,
	exportId: string,
): Promise<ConfirmExportPreview> {
	const resolved = await resolveExport(organizationId, actor, exportId);
	if (!resolved.ok) return resolved.rejection;
	return { status: "ready", ...(await planConfirmation(organizationId, resolved)) };
}

/**
 * Confirms a completed export as paid: each day it carried that is not settled yet gets
 * a settlement with method `export`, the export, and a copy of the values the file
 * carried. Days settled before are reported and left as they are, and days this export
 * settled that were unsettled since are skipped, so confirming the same export again
 * settles nothing new.
 */
export async function confirmExportAsPaid(
	organizationId: string,
	actor: PayrollSettlementActor,
	exportId: string,
): Promise<ConfirmExportResult> {
	const resolved = await resolveExport(organizationId, actor, exportId);
	if (!resolved.ok) return resolved.rejection;
	const plan = await planConfirmation(organizationId, resolved);
	const toSettle = new Set(plan.newlySettled.map(dayKey));
	const values = resolved.carried.filter((day) => toSettle.has(dayKey(day)));
	const inserted = await insertSettlements(organizationId, actor, values, {
		method: "export",
		payrollExportJobId: resolved.jobId,
	});

	// A day a concurrent settle took between the plan and the insert is already settled.
	const settledNow = new Set(inserted.map(dayKey));
	return {
		status: "settled",
		newlySettled: sortDays(inserted),
		alreadySettled: sortDays([
			...plan.alreadySettled,
			...plan.newlySettled.filter((day) => !settledNow.has(dayKey(day))),
		]),
		inUnclosedMonths: plan.inUnclosedMonths,
		previouslyUnsettled: plan.previouslyUnsettled,
	};
}

/**
 * The organization's most recent completed exports that recorded carried days and
 * carried only employees in the actor's grant, newest first.
 */
export async function listExportsToConfirm(
	organizationId: string,
	actor: PayrollSettlementActor,
	limit = 20,
): Promise<PayrollExportToConfirm[]> {
	if (!actor.orgAdmin) {
		if (
			!actor.employeeId ||
			!(await hasActivePayrollAccessGrant({
				organizationId,
				payrollEmployeeId: actor.employeeId,
			}))
		) {
			return [];
		}
	}
	const carriedJobs = db
		.selectDistinct({ jobId: payrollExportCarriedDay.jobId })
		.from(payrollExportCarriedDay)
		.where(eq(payrollExportCarriedDay.organizationId, organizationId));
	const jobs = await db
		.select({
			id: payrollExportJob.id,
			fileName: payrollExportJob.fileName,
			filters: payrollExportJob.filters,
			completedAt: payrollExportJob.completedAt,
			settledDaysLeftOut: payrollExportJob.settledDaysLeftOut,
			includesSettledDays: payrollExportJob.includesSettledDays,
		})
		.from(payrollExportJob)
		.where(
			and(
				eq(payrollExportJob.organizationId, organizationId),
				eq(payrollExportJob.status, "completed"),
				inArray(payrollExportJob.id, carriedJobs),
			),
		)
		.orderBy(desc(payrollExportJob.completedAt), desc(payrollExportJob.id))
		.limit(limit);
	if (jobs.length === 0) return [];
	const jobIds = jobs.map((job) => job.id);

	const [carried, settled] = await Promise.all([
		db
			.select({
				jobId: payrollExportCarriedDay.jobId,
				employeeId: payrollExportCarriedDay.employeeId,
				days: count(),
			})
			.from(payrollExportCarriedDay)
			.where(
				and(
					eq(payrollExportCarriedDay.organizationId, organizationId),
					inArray(payrollExportCarriedDay.jobId, jobIds),
				),
			)
			.groupBy(payrollExportCarriedDay.jobId, payrollExportCarriedDay.employeeId),
		db
			.select({ jobId: payrollExportCarriedDay.jobId, days: count() })
			.from(payrollExportCarriedDay)
			.innerJoin(
				payrollSettledDay,
				and(
					eq(payrollSettledDay.organizationId, payrollExportCarriedDay.organizationId),
					eq(payrollSettledDay.employeeId, payrollExportCarriedDay.employeeId),
					eq(payrollSettledDay.date, payrollExportCarriedDay.date),
					isNull(payrollSettledDay.unsettledAt),
				),
			)
			.where(
				and(
					eq(payrollExportCarriedDay.organizationId, organizationId),
					inArray(payrollExportCarriedDay.jobId, jobIds),
				),
			)
			.groupBy(payrollExportCarriedDay.jobId),
	]);
	const carriedByJob = Map.groupBy(carried, (row) => row.jobId);
	const settledByJob = new Map(settled.map((row) => [row.jobId, row.days]));
	// The grant, plus its employees who left during or after each export's period (#1894).
	const startDates = [...new Set(jobs.map((job) => job.filters.dateRange.start))];
	const allowedByStart = new Map(
		await Promise.all(
			startDates.map(
				async (startDate) =>
					[
						startDate,
						new Set(await resolvePeriodEmployeeIds(organizationId, actor, startDate)),
					] as const,
			),
		),
	);

	return jobs.flatMap((job) => {
		const employees = carriedByJob.get(job.id) ?? [];
		const allowed = allowedByStart.get(job.filters.dateRange.start) ?? new Set<string>();
		if (employees.some((row) => !allowed.has(row.employeeId))) return [];
		return [
			{
				jobId: job.id,
				fileName: job.fileName,
				startDate: job.filters.dateRange.start,
				endDate: job.filters.dateRange.end,
				completedAt: job.completedAt?.toISOString() ?? null,
				employeeCount: employees.length,
				carriedDays: employees.reduce((sum, row) => sum + row.days, 0),
				settledDays: settledByJob.get(job.id) ?? 0,
				settledDaysLeftOut: job.settledDaysLeftOut,
				includesSettledDays: job.includesSettledDays,
			},
		];
	});
}

// ============================================
// INTERNALS
// ============================================

/**
 * The carried days split as a settle would split them, without the days whose
 * settlement from this export was unsettled since and which are not settled now.
 */
async function planConfirmation(
	organizationId: string,
	resolved: { jobId: string; carried: PayrollCarriedDay[] },
): Promise<ConfirmExportPlan> {
	const unsettledRows = await db
		.selectDistinct({
			employeeId: payrollSettledDay.employeeId,
			date: payrollSettledDay.date,
		})
		.from(payrollSettledDay)
		.where(
			and(
				eq(payrollSettledDay.organizationId, organizationId),
				eq(payrollSettledDay.payrollExportJobId, resolved.jobId),
				isNotNull(payrollSettledDay.unsettledAt),
			),
		);
	const unsettled = new Set(unsettledRows.map(dayKey));
	const plan = await planDays(organizationId, resolved.carried);
	const skipped = new Set(
		plan.newlySettled.filter((day) => unsettled.has(dayKey(day))).map(dayKey),
	);
	return {
		newlySettled: plan.newlySettled.filter((day) => !skipped.has(dayKey(day))),
		alreadySettled: plan.alreadySettled,
		inUnclosedMonths: plan.inUnclosedMonths.filter((day) => !skipped.has(dayKey(day))),
		previouslyUnsettled: sortDays(plan.newlySettled.filter((day) => skipped.has(dayKey(day)))),
	};
}

async function resolveExport(
	organizationId: string,
	actor: PayrollSettlementActor,
	exportId: string,
): Promise<
	| { ok: true; jobId: string; carried: PayrollCarriedDay[] }
	| { ok: false; rejection: ConfirmExportRejection }
> {
	if (!z.uuid().safeParse(exportId).success) {
		return { ok: false, rejection: { status: "not_found" } };
	}
	const [job] = await db
		.select({
			id: payrollExportJob.id,
			status: payrollExportJob.status,
			filters: payrollExportJob.filters,
		})
		.from(payrollExportJob)
		.where(
			and(eq(payrollExportJob.id, exportId), eq(payrollExportJob.organizationId, organizationId)),
		)
		.limit(1);
	if (!job) return { ok: false, rejection: { status: "not_found" } };
	if (job.status !== "completed") return { ok: false, rejection: { status: "not_completed" } };

	const carried = await loadExportCarriedDays(db, { organizationId, jobId: job.id });
	const employeeIds = [...new Set(carried.map((day) => day.employeeId))].toSorted();
	const allowed = new Set(
		await resolvePeriodEmployeeIds(organizationId, actor, job.filters.dateRange.start),
	);
	const outside = employeeIds.filter((id) => !allowed.has(id));
	if (allowed.size === 0 || outside.length > 0) {
		return {
			ok: false,
			rejection: {
				status: "out_of_scope",
				employeeIds: outside.length > 0 ? outside : employeeIds,
			},
		};
	}
	if (carried.length === 0) return { ok: false, rejection: { status: "nothing_carried" } };
	return { ok: true, jobId: job.id, carried };
}

function dayKey(day: PayrollDayKey): string {
	return `${day.employeeId}:${day.date}`;
}

function sortDays(days: readonly PayrollDayKey[]): PayrollDayKey[] {
	return days
		.map(({ employeeId, date }) => ({ employeeId, date }))
		.toSorted(
			(left, right) =>
				left.employeeId.localeCompare(right.employeeId) || left.date.localeCompare(right.date),
		);
}
