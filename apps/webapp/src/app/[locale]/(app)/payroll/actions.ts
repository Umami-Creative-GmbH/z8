"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { db, payrollExportConfig, payrollExportFormat } from "@/db";
import { organization } from "@/db/auth-schema";
import { payrollBlockerDismissal, payrollExportCarriedDay, payrollExportJob } from "@/db/schema";
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { isOrgAdminForOrganization } from "@/lib/payroll-access/org-admin";
import {
	getActivePayrollAccessGrantScope,
	hasActivePayrollAccessGrant,
	intersectPayrollScope,
	resolveOrganizationPayrollEmployeeIds,
	resolvePayrollAccessibleEmployeeIds,
} from "@/lib/payroll-access/permissions";
import {
	createExportJob,
	enqueuePayrollExportJob,
	getExportDownloadUrl,
	getExportJobHistory,
	getFormatter,
	getPayrollExportConfig,
	type PayrollExportFilters,
	type PayrollExportJobSummary,
	processExportJob,
	unmappedOvertimePayoutsForExport,
} from "@/lib/payroll-export";
import {
	isPayrollWorkspaceExportFormatId,
	type PayrollWorkspaceExportFormatId,
	payrollWorkspaceExportFormatIds,
} from "@/lib/payroll-export/format-registry";
import {
	type ConfirmExportPreview,
	type ConfirmExportResult,
	confirmExportAsPaid,
	listExportsToConfirm,
	type PayrollExportToConfirm,
	previewConfirmExportAsPaid,
} from "@/lib/payroll-period/export-confirmation";
import { readPeriodDay } from "@/lib/payroll-period/read-day";
import {
	listDepartedGrantEmployees,
	readPeriodForEmployees,
	resolvePeriodEmployeeIds,
} from "@/lib/payroll-period/read-period";
import { readPeriodRecordsForEmployees } from "@/lib/payroll-period/read-period-records";
import { loadActiveSettledDays } from "@/lib/payroll-period/settled-days-store";
import {
	MAX_SETTLE_SPECIFIC_DAYS,
	type PayrollSettleEmployeeBreakdown,
	type PayrollSettlementHistoryEntry,
	previewSettleDays,
	previewSettleSpecificDays,
	type SettleDaysOptions,
	type SettleDaysPreview,
	type SettleDaysResult,
	settleDays,
	settleSpecificDays,
	settlementHistory,
	unsettleDays,
} from "@/lib/payroll-period/settlement";
import type { PayrollPeriodDayDetail, PayrollPeriodRead } from "@/lib/payroll-period/types";
import {
	getPayrollReadiness,
	type PayrollReadinessResult,
} from "@/lib/payroll-readiness/get-payroll-readiness";
import {
	exportPayrollPeriodToPDF,
	generatePayrollPDFFilename,
} from "@/lib/payroll-workspace/pdf-exporter";
import { getPayrollWorkspaceSummary } from "@/lib/payroll-workspace/summary";
import type {
	DismissiblePayrollBlockerType,
	PayrollWorkspaceSummary,
} from "@/lib/payroll-workspace/types";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import {
	type DiscardPayrollRunResult,
	discardPayrollRun,
	listUnconfirmedPayrollRuns,
	type UnconfirmedPayrollRun,
} from "@/lib/travel-expenses/payroll-run";
import {
	getPayrollRunReadiness,
	type PayrollRunReadiness,
} from "@/lib/travel-expenses/payroll-run-readiness";
import { getTranslate } from "@/tolgee/server";
import { mapPayrollWorkspaceActionError } from "./action-errors";
import { resolveScopedPayrollEmployeeIdsForAction } from "./action-helpers";

type PayrollTranslate = Awaited<ReturnType<typeof getTranslate>>;

interface PayrollWorkspaceActor {
	organizationId: string;
	userId: string;
	employeeId: string | null;
	employeeRole: "admin" | "manager" | "employee";
	name: string;
	isOrgAdmin: boolean;
}

export interface PayrollWorkspaceRequest {
	startDate: string;
	endDate: string;
	label: string;
	employeeIds?: string[];
}

export interface DismissPayrollBlockerRequest extends PayrollWorkspaceRequest {
	blockerId: string;
	blockerType: DismissiblePayrollBlockerType;
}

export interface PayrollExportFormatOption {
	id: string;
	label: string;
}

const PAYROLL_BLOCKER_TYPES = [
	"missing_clock_out",
	"pending_absence",
	"pending_time_correction",
] as const satisfies readonly DismissiblePayrollBlockerType[];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function getPayrollWorkspaceSummaryAction(
	request: PayrollWorkspaceRequest,
): Promise<ServerActionResult<PayrollWorkspaceSummary>> {
	return runPayrollWorkspaceAction((t) => buildScopedPayrollWorkspaceSummary(t, request));
}

/** The period's day rows and absence list (#1891), for the Days and Absences tabs. */
export type PayrollPeriodView = Pick<
	PayrollPeriodRead,
	"period" | "employees" | "absences" | "settlement"
>;

export async function getPayrollPeriodAction(
	request: PayrollWorkspaceRequest,
): Promise<ServerActionResult<PayrollPeriodView>> {
	return runPayrollWorkspaceAction(async (t) => {
		const { actor, scopedEmployeeIds } = await resolvePayrollWorkspaceActionContext(
			t,
			request,
			undefined,
			{ includeDeparted: true },
		);
		const read = await readPeriodForEmployees(
			actor.organizationId,
			toPayrollPeriodActor(actor),
			{ startDate: request.startDate, endDate: request.endDate, label: request.label.trim() },
			{ employeeIds: scopedEmployeeIds },
		);
		return {
			period: read.period,
			employees: read.employees,
			absences: read.absences,
			settlement: read.settlement,
		};
	});
}

/** What settling the workspace's scope and period does or did (#1896), as counts. */
export interface PayrollSettlementCounts {
	newDays: number;
	alreadySettledDays: number;
	/** Days to settle whose month is not closed, per month (YYYY-MM): a warning only. */
	unclosedMonths: { month: string; days: number }[];
	/**
	 * Confirming an export as paid (#1899): days this export settled that were unsettled
	 * since, which confirming again skips.
	 */
	previouslyUnsettledDays?: number;
	/** Settling by hand: unsettled days nobody recorded anything on, never settled. */
	skippedWithoutEntriesDays?: number;
	/** Settling by hand: days with a pending absence left out by the option. */
	skippedPendingAbsenceDays?: number;
	/** Settling by hand: days in months not closed left out by the option. */
	skippedUnclosedMonthDays?: number;
	/** Settling by hand: days settled although a pending absence on them is not paid. */
	pendingAbsenceDays?: number;
	/** Settling by hand: the days to settle per employee, with their credited minutes. */
	employees?: PayrollSettleEmployeeBreakdown[];
}

/**
 * Settling a date range by hand (#1896): `startDate`, `endDate` and `employeeIds` name
 * the days, inside the grant; the options leave out days not to settle yet.
 */
export type PayrollSettleDaysRequest = PayrollWorkspaceRequest & SettleDaysOptions;

/** Settling the employee-days picked in the Days tab. */
export interface PayrollSettleSpecificDaysRequest {
	days: { employeeId: string; date: string }[];
	skipPendingAbsences?: boolean;
}

export async function previewSettlePayrollDaysAction(
	request: PayrollSettleDaysRequest,
): Promise<ServerActionResult<PayrollSettlementCounts>> {
	return runPayrollWorkspaceAction(async (t) => {
		const options = parsePayrollActionInput(t, settleOptionsSchema, request);
		const { organizationId, actor, scope, range } = await resolvePayrollSettlementRequest(
			t,
			request,
		);
		const preview = await previewSettleDays(organizationId, actor, scope, range, options);
		return settlementCounts(t, actor.userId, preview);
	});
}

/** Settles the days with entries of the scope and range by hand (#1896). */
export async function settlePayrollDaysAction(
	request: PayrollSettleDaysRequest,
): Promise<ServerActionResult<PayrollSettlementCounts>> {
	return runPayrollWorkspaceAction(async (t) => {
		const options = parsePayrollActionInput(t, settleOptionsSchema, request);
		const { organizationId, actor, scope, range } = await resolvePayrollSettlementRequest(
			t,
			request,
		);
		const result = await settleDays(organizationId, actor, scope, range, options);
		const counts = settlementCounts(t, actor.userId, result);
		revalidatePath("/payroll");
		return counts;
	});
}

/** What settling the employee-days picked in the Days tab would do. */
export async function previewSettleSpecificPayrollDaysAction(
	request: PayrollSettleSpecificDaysRequest,
): Promise<ServerActionResult<PayrollSettlementCounts>> {
	return runPayrollWorkspaceAction(async (t) => {
		const { days, ...options } = parsePayrollActionInput(t, settleSpecificDaysSchema, request);
		const { organizationId, actor } = await resolvePayrollSettlementActor(t);
		const preview = await previewSettleSpecificDays(organizationId, actor, days, options);
		return settlementCounts(t, actor.userId, preview);
	});
}

/** Settles the employee-days picked in the Days tab or its side panel. */
export async function settleSpecificPayrollDaysAction(
	request: PayrollSettleSpecificDaysRequest,
): Promise<ServerActionResult<PayrollSettlementCounts>> {
	return runPayrollWorkspaceAction(async (t) => {
		const { days, ...options } = parsePayrollActionInput(t, settleSpecificDaysSchema, request);
		const { organizationId, actor } = await resolvePayrollSettlementActor(t);
		const result = await settleSpecificDays(organizationId, actor, days, options);
		const counts = settlementCounts(t, actor.userId, result);
		revalidatePath("/payroll");
		return counts;
	});
}

/** The most settlement events the Settlement tab lists. */
const SETTLEMENT_HISTORY_LIMIT = 200;

/**
 * The settlement history of the workspace's scope and range, newest first, for the
 * Settlement tab; `hasMore` when older events were left out.
 */
export async function getPayrollSettlementHistoryAction(
	request: PayrollWorkspaceRequest,
): Promise<ServerActionResult<{ entries: PayrollSettlementHistoryEntry[]; hasMore: boolean }>> {
	return runPayrollWorkspaceAction(async (t) => {
		const { organizationId, actor, scope, range } = await resolvePayrollSettlementRequest(
			t,
			request,
		);
		const entries = await settlementHistory(organizationId, actor, scope, range, {
			limit: SETTLEMENT_HISTORY_LIMIT + 1,
		});
		return {
			entries: entries.slice(0, SETTLEMENT_HISTORY_LIMIT),
			hasMore: entries.length > SETTLEMENT_HISTORY_LIMIT,
		};
	});
}

/** Unsettles every settled day of the workspace's scope and period, with a reason (#1896). */
export async function unsettlePayrollDaysAction(
	request: PayrollWorkspaceRequest & { reason: string },
): Promise<ServerActionResult<{ unsettledDays: number }>> {
	return runPayrollWorkspaceAction(async (t) => {
		const { organizationId, actor, scope, range } = await resolvePayrollSettlementRequest(
			t,
			request,
		);
		// Employees who left during or after the period are in scope too (#1894).
		const settled = await loadActiveSettledDays(db, {
			organizationId,
			employeeIds: await resolvePeriodEmployeeIds(organizationId, actor, range.startDate, scope),
			...range,
		});
		const result = await unsettleDays(
			organizationId,
			actor,
			settled.map(({ employeeId, date }) => ({ employeeId, date })),
			request.reason,
		);
		if (result.status === "reason_required") throwUnsettleReasonRequired(t);
		if (result.status !== "unsettled") throwPayrollSettlementOutOfScope(t, actor.userId);
		revalidatePath("/payroll");
		return { unsettledDays: result.unsettled.length };
	});
}

/** The completed exports the grant holder may confirm as paid (#1899), newest first. */
export async function getPayrollExportsToConfirmAction(): Promise<
	ServerActionResult<PayrollExportToConfirm[]>
> {
	return runPayrollWorkspaceAction(async (t) => {
		const { organizationId, actor } = await resolvePayrollSettlementActor(t);
		return listExportsToConfirm(organizationId, actor);
	});
}

/** What confirming the export as paid would settle (#1899), as counts. */
export async function previewConfirmPayrollExportPaidAction(
	jobId: string,
): Promise<ServerActionResult<PayrollSettlementCounts>> {
	return runPayrollWorkspaceAction(async (t) => {
		const { organizationId, actor } = await resolvePayrollSettlementActor(t);
		const preview = await previewConfirmExportAsPaid(organizationId, actor, jobId);
		return exportConfirmationCounts(t, actor.userId, preview);
	});
}

/** Confirms a completed export as paid (#1899): settles the employee-days it carried. */
export async function confirmPayrollExportPaidAction(
	jobId: string,
): Promise<ServerActionResult<PayrollSettlementCounts>> {
	return runPayrollWorkspaceAction(async (t) => {
		const { organizationId, actor } = await resolvePayrollSettlementActor(t);
		const result = await confirmExportAsPaid(organizationId, actor, jobId);
		const counts = exportConfirmationCounts(t, actor.userId, result);
		revalidatePath("/payroll");
		return counts;
	});
}

async function resolvePayrollSettlementActor(t: PayrollTranslate) {
	const workspaceActor = await requirePayrollWorkspaceActor(t);
	return {
		organizationId: workspaceActor.organizationId,
		actor: toPayrollPeriodActor(workspaceActor),
	};
}

/** The signed-in payroll actor as the payroll period module names an actor. */
function toPayrollPeriodActor(actor: PayrollWorkspaceActor) {
	return {
		employeeId: actor.employeeId,
		userId: actor.userId,
		name: actor.name,
		...(actor.isOrgAdmin ? { orgAdmin: true as const } : {}),
	};
}

/** Days to settle in months that are not closed, counted per month (YYYY-MM). */
function unclosedMonthCounts(
	days: readonly { date: string }[],
): PayrollSettlementCounts["unclosedMonths"] {
	return [...Map.groupBy(days, (day) => day.date.slice(0, 7))]
		.map(([month, monthDays]) => ({ month, days: monthDays.length }))
		.toSorted((left, right) => left.month.localeCompare(right.month));
}

function throwUnsettleReasonRequired(t: PayrollTranslate): never {
	throw new ValidationError({
		message: t("payroll.settle.reasonRequired", "A reason is required to unsettle days"),
		field: "reason",
	});
}

function exportConfirmationCounts(
	t: PayrollTranslate,
	userId: string,
	result: ConfirmExportPreview | ConfirmExportResult,
): PayrollSettlementCounts {
	switch (result.status) {
		case "not_found":
			throw new ValidationError({
				message: t("payroll.confirmPaid.notFound", "This export was not found"),
				field: "jobId",
			});
		case "not_completed":
			throw new ValidationError({
				message: t(
					"payroll.confirmPaid.notCompleted",
					"Only a completed export can be confirmed as paid",
				),
				field: "jobId",
			});
		case "nothing_carried":
			throw new ValidationError({
				message: t(
					"payroll.confirmPaid.nothingCarried",
					"This export recorded no days, so it can't be confirmed as paid: it was made before settled days existed, or delivered to a connected payroll system. Settle its days by hand with Settle days.",
				),
				field: "jobId",
			});
		case "out_of_scope":
			throwPayrollSettlementOutOfScope(t, userId);
	}
	return {
		newDays: result.newlySettled.length,
		alreadySettledDays: result.alreadySettled.length,
		unclosedMonths: unclosedMonthCounts(result.inUnclosedMonths),
		previouslyUnsettledDays: result.previouslyUnsettled.length,
	};
}

/**
 * The settlement history of one employee-day (#1897), newest first, for the Days
 * tab's side panel: who settled or unsettled it, when, how, why, and what was paid.
 */
export async function getPayrollDaySettlementHistoryAction(request: {
	employeeId: string;
	date: string;
}): Promise<ServerActionResult<PayrollSettlementHistoryEntry[]>> {
	return runPayrollWorkspaceAction(async (t) => {
		const day = parsePayrollActionInput(t, payrollDaySchema, request);
		const { organizationId, actor, scope, range } = await resolvePayrollDayRequest(t, day);
		return settlementHistory(organizationId, actor, scope, range);
	});
}

/** Unsettles one employee-day from the side panel, with a required reason (#1897). */
export async function unsettlePayrollDayAction(request: {
	employeeId: string;
	date: string;
	reason: string;
}): Promise<ServerActionResult<{ unsettled: boolean }>> {
	return runPayrollWorkspaceAction(async (t) => {
		const { reason, ...day } = parsePayrollActionInput(t, unsettlePayrollDaySchema, request);
		if (reason.length === 0) throwUnsettleReasonRequired(t);
		const { organizationId, actor } = await resolvePayrollDayRequest(t, day);
		const result = await unsettleDays(organizationId, actor, [day], reason);
		if (result.status === "reason_required") throwUnsettleReasonRequired(t);
		if (result.status !== "unsettled") throwPayrollSettlementOutOfScope(t, actor.userId);
		revalidatePath("/payroll");
		return { unsettled: result.unsettled.length === 1 };
	});
}

/** One employee and one employee-local date, as the Days tab's side panel names a day. */
const payrollDaySchema = z.object({
	employeeId: z.string().trim().min(1),
	date: z.iso.date(),
});

const unsettlePayrollDaySchema = payrollDaySchema.extend({
	reason: z.string().trim().max(2_000),
});

/** The options of settling by hand; absent options keep the module's defaults. */
const settleOptionsSchema = z.object({
	skipUnclosedMonths: z.boolean().optional(),
	skipPendingAbsences: z.boolean().optional(),
});

const settleSpecificDaysSchema = z.object({
	days: z.array(payrollDaySchema).min(1).max(MAX_SETTLE_SPECIFIC_DAYS),
	skipPendingAbsences: z.boolean().optional(),
});

/** The parsed input, or a ValidationError naming the first invalid field. */
function parsePayrollActionInput<Schema extends z.ZodType>(
	t: PayrollTranslate,
	schema: Schema,
	input: unknown,
): z.output<Schema> {
	const parsed = schema.safeParse(input);
	if (parsed.success) return parsed.data;
	const field = parsed.error.issues[0]?.path.join(".") || undefined;
	throw new ValidationError({
		message: t("payroll.errors.invalidRequest", "The request is not valid"),
		field,
	});
}

async function resolvePayrollDayRequest(
	t: PayrollTranslate,
	day: { employeeId: string; date: string },
) {
	return resolvePayrollSettlementRequest(t, {
		startDate: day.date,
		endDate: day.date,
		label: day.date,
		employeeIds: [day.employeeId],
	});
}

async function resolvePayrollSettlementRequest(
	t: PayrollTranslate,
	request: PayrollWorkspaceRequest,
) {
	const workspaceActor = await requirePayrollWorkspaceActor(t);
	validatePayrollWorkspaceRequest(t, request);
	const employeeIds = validateRequestedEmployeeIds(t, request.employeeIds);
	return {
		organizationId: workspaceActor.organizationId,
		actor: toPayrollPeriodActor(workspaceActor),
		scope: { employeeIds },
		range: { startDate: request.startDate, endDate: request.endDate },
	};
}

function settlementCounts(
	t: PayrollTranslate,
	userId: string,
	result: SettleDaysPreview | SettleDaysResult,
): PayrollSettlementCounts {
	if (result.status === "invalid_range") {
		throw new ValidationError({
			message: t(
				"payroll.settle.invalidRange",
				"Choose a period of at most one year to settle days",
			),
			field: "endDate",
		});
	}
	if (result.status === "invalid_days") {
		throw new ValidationError({
			message: t(
				"payroll.settle.invalidDays",
				"Choose at most 5,000 days within one year to settle",
			),
			field: "days",
		});
	}
	if (result.status === "out_of_scope") throwPayrollSettlementOutOfScope(t, userId);
	return {
		newDays: result.newlySettled.length,
		alreadySettledDays: result.alreadySettled.length,
		unclosedMonths: unclosedMonthCounts(result.inUnclosedMonths),
		skippedWithoutEntriesDays: result.skippedWithoutEntries.length,
		skippedPendingAbsenceDays: result.skippedPendingAbsences.length,
		skippedUnclosedMonthDays: result.skippedUnclosedMonths.length,
		pendingAbsenceDays: result.withPendingAbsences.length,
		employees: result.employees,
	};
}

function throwPayrollSettlementOutOfScope(t: PayrollTranslate, userId: string): never {
	throw new AuthorizationError({
		message: t(
			"payroll.settle.outOfScope",
			"Some selected employees are outside your payroll access",
		),
		userId,
		resource: "payroll_workspace",
		action: "write",
	});
}

/**
 * The work and break records of one employee-day (#1894), for the Days tab's read-only
 * side panel. Limited to the payroll access grant's scope, like the period read.
 */
export async function getPayrollDayRecordsAction(request: {
	employeeId: string;
	date: string;
}): Promise<ServerActionResult<PayrollPeriodDayDetail>> {
	return runPayrollWorkspaceAction(async (t) => {
		const day = parsePayrollActionInput(t, payrollDaySchema, request);
		const workspaceActor = await requirePayrollWorkspaceActor(t);
		// The module checks the actor's scope, employees who left during or after the day included.
		const detail = await readPeriodDay(
			workspaceActor.organizationId,
			toPayrollPeriodActor(workspaceActor),
			day,
		);
		if (!detail) {
			throw new AuthorizationError({
				message: t(
					"payroll.errors.noAvailableEmployees",
					"No payroll employees are available in your access scope",
				),
				userId: workspaceActor.userId,
				resource: "payroll_workspace",
				action: "read",
			});
		}
		return detail;
	});
}

export async function dismissPayrollBlockerAction(
	request: DismissPayrollBlockerRequest,
): Promise<ServerActionResult<{ dismissed: true }>> {
	return runPayrollWorkspaceAction(async (t) => {
		const authenticatedActor = await requirePayrollWorkspaceActor(t);
		const { blockerId, blockerType } = validatePayrollBlockerDismissalRequest(t, request);
		// Blockers of employees who left are in the workspace's summary, so they can be dismissed.
		const { actor, period, scopedEmployeeIds } = await resolvePayrollWorkspaceActionContext(
			t,
			request,
			authenticatedActor,
			{ includeDeparted: true },
		);
		if (!actor.employeeId) {
			throw new ValidationError({
				message: t(
					"payroll.errors.employeeProfileRequiredToDismissBlocker",
					"An employee profile in this organization is required to dismiss payroll blockers",
				),
				field: "blockerId",
			});
		}
		const organizationId = actor.organizationId;
		const findExistingDismissal = () =>
			db.query.payrollBlockerDismissal.findFirst({
				columns: {
					organizationId: true,
					blockerType: true,
					sourceId: true,
					employeeId: true,
				},
				where: and(
					eq(payrollBlockerDismissal.organizationId, organizationId),
					eq(payrollBlockerDismissal.blockerType, blockerType),
					eq(payrollBlockerDismissal.sourceId, blockerId),
				),
			});
		const dismissalIsInScope = (dismissal: Awaited<ReturnType<typeof findExistingDismissal>>) =>
			dismissal?.organizationId === organizationId &&
			dismissal.blockerType === blockerType &&
			dismissal.sourceId === blockerId &&
			scopedEmployeeIds.includes(dismissal.employeeId);

		const existingDismissal = await findExistingDismissal();

		if (existingDismissal) {
			if (dismissalIsInScope(existingDismissal)) {
				return { dismissed: true };
			}

			throwPayrollBlockerAuthorizationError(t, actor.userId);
		}

		const summary = await getPayrollWorkspaceSummary({
			organizationId,
			allowedEmployeeIds: scopedEmployeeIds,
			period,
			generatedBy: {
				id: actor.employeeId,
				name: actor.name,
			},
		});
		const blocker = summary.blockers.find(
			(candidate) => candidate.id === blockerId && candidate.type === blockerType,
		);

		if (!blocker) {
			if (dismissalIsInScope(await findExistingDismissal())) {
				return { dismissed: true };
			}

			throwPayrollBlockerAuthorizationError(t, actor.userId);
		}

		if (!scopedEmployeeIds.includes(blocker.employeeId)) {
			throwPayrollBlockerAuthorizationError(t, actor.userId);
		}

		const insertedDismissals = await db
			.insert(payrollBlockerDismissal)
			.values({
				organizationId,
				blockerType,
				sourceId: blockerId,
				employeeId: blocker.employeeId,
				dismissedByEmployeeId: actor.employeeId,
			})
			.onConflictDoNothing()
			.returning({ id: payrollBlockerDismissal.id });

		if (insertedDismissals.length === 0) {
			if (dismissalIsInScope(await findExistingDismissal())) {
				return { dismissed: true };
			}

			throwPayrollBlockerAuthorizationError(t, actor.userId);
		}

		return { dismissed: true };
	});
}

export async function exportPayrollPdfAction(
	request: PayrollWorkspaceRequest,
): Promise<ServerActionResult<{ filename: string; data: number[] }>> {
	return runPayrollWorkspaceAction(async (t) => {
		// The PDF reads the payroll period module, so it matches the Days tab (#1900).
		const { actor, scopedEmployeeIds } = await resolvePayrollWorkspaceActionContext(
			t,
			request,
			undefined,
			{ includeDeparted: true },
		);
		const read = await readPeriodForEmployees(
			actor.organizationId,
			toPayrollPeriodActor(actor),
			{ startDate: request.startDate, endDate: request.endDate, label: request.label.trim() },
			{ employeeIds: scopedEmployeeIds },
		);
		// The day sheets' clock times and breaks, for the employees and days of the read.
		const records = await readPeriodRecordsForEmployees(actor.organizationId, {
			employees: read.employees,
			startDate: read.period.start,
			endDate: read.period.end,
		});
		const pdfBytes = await exportPayrollPeriodToPDF(read, {
			t,
			locale: await getLocale(),
			records,
		});

		return {
			filename: generatePayrollPDFFilename(read.summary),
			data: Array.from(pdfBytes),
		};
	});
}

export async function startScopedPayrollExportAction(
	request: PayrollWorkspaceRequest & {
		formatId: string;
		/** Reissue the file with its settled days (#1898); the Export tab warns first. */
		includeSettledDays?: boolean;
	},
): Promise<
	ServerActionResult<{
		jobId: string;
		isAsync: boolean;
		fileContent?: string;
		/** Overtime payouts the file left out for want of an "overtime" mapping (#1001). */
		unmappedOvertimePayoutCount?: number;
		/** Settled and changed-since-settled employee-days the file left out (#1898). */
		settledDaysLeftOut?: number;
	}>
> {
	return runPayrollWorkspaceAction(async (t) => {
		const formatId = validateExportFormatId(t, request.formatId);
		const { actor, period, employeeIds } = await resolvePayrollExportScope(t, request);
		if (!actor.employeeId) {
			throw new ValidationError({
				message: t(
					"payroll.export.employeeProfileRequired",
					"An employee profile in this organization is required to trigger a file export",
				),
				field: "formatId",
			});
		}
		if (employeeIds.length === 0) {
			throw new ValidationError({
				message: t(
					"payroll.export.nobodyEmployedInPeriod",
					"No one in your payroll access was employed in this period.",
				),
				field: "startDate",
			});
		}

		const configuredFormat = await getPayrollExportConfig(actor.organizationId, formatId);
		if (!configuredFormat) {
			throw new ValidationError({
				message: t(
					"payroll.errors.exportFormatNotConfigured",
					"Payroll export format is not configured",
				),
				field: "formatId",
			});
		}

		const filters: PayrollExportFilters = {
			dateRange: {
				start: period.start,
				end: period.end,
			},
			employeeIds,
		};

		// Only an organization administrator executes eligible historical repairs (#322),
		// as for the repair route; other payroll users collect without repair.
		const ability = actor.isOrgAdmin ? null : await getAbility();
		const { jobId, isAsync } = await createExportJob({
			organizationId: actor.organizationId,
			formatId,
			requestedById: actor.employeeId,
			filters,
			repairActorUserId:
				actor.isOrgAdmin || ability?.can("manage", "OrgSettings") ? actor.userId : null,
			// The workspace prepares the file: settled days are left out unless reissued.
			settledDays: request.includeSettledDays === true ? "include" : "leave_out",
		});

		if (isAsync) {
			await enqueuePayrollExportJob({
				jobId,
				organizationId: actor.organizationId,
			});
			return { jobId, isAsync };
		}

		const { result, settledDaysLeftOut } = await processExportJob({
			jobId,
			organizationId: actor.organizationId,
		});
		const fileContent = result?.content
			? typeof result.content === "string"
				? result.content
				: result.content.toString("utf-8")
			: undefined;

		return {
			jobId,
			isAsync,
			fileContent,
			unmappedOvertimePayoutCount: result?.metadata.unmappedOvertimePayouts.length ?? 0,
			settledDaysLeftOut: settledDaysLeftOut ?? 0,
		};
	});
}

/**
 * Before exporting (#1001): how many uncancelled overtime payouts an export of
 * this period, format and employee selection would leave out because no wage
 * type is mapped to "overtime" for the format.
 */
export async function getOvertimePayoutExportReadinessAction(
	request: PayrollWorkspaceRequest & { formatId: string },
): Promise<ServerActionResult<{ unmappedPayoutCount: number }>> {
	return runPayrollWorkspaceAction(async (t) => {
		const formatId = validateExportFormatId(t, request.formatId);
		const { actor, period, employeeIds } = await resolvePayrollExportScope(t, request);
		if (employeeIds.length === 0) return { unmappedPayoutCount: 0 };
		const unmapped = await unmappedOvertimePayoutsForExport(actor.organizationId, formatId, {
			dateRange: { start: period.start, end: period.end },
			employeeIds,
		});
		return { unmappedPayoutCount: unmapped.length };
	});
}

/**
 * How many employees an export of the period would cover (#1001): lets a grant
 * that covers only employees who have left show, before exporting, that nobody
 * was employed in the chosen period.
 */
export async function getPayrollExportScopeAction(
	request: PayrollWorkspaceRequest,
): Promise<ServerActionResult<{ employeeCount: number }>> {
	return runPayrollWorkspaceAction(async (t) => {
		const { employeeIds } = await resolvePayrollExportScope(t, request);
		return { employeeCount: employeeIds.length };
	});
}

const PAYROLL_EXPORT_HISTORY_LIMIT = 50;
const PAYROLL_OFFICER_HISTORY_SCAN_LIMIT = 250;

/**
 * Organization-level payroll readiness checks for the `/payroll` Overview tab (#1957).
 * Strictly limited to organization administrators.
 */
export async function getPayrollReadinessForWorkspaceAction(request: {
	startDate: string;
	endDate: string;
}): Promise<ServerActionResult<PayrollReadinessResult>> {
	return runPayrollWorkspaceAction(async (t) => {
		const actor = await requireOrgAdminPayrollActor(t);
		const startPlain = parsePlainDateForAction(t, request.startDate, "startDate");
		const endPlain = parsePlainDateForAction(t, request.endDate, "endDate");
		if (comparePlainDates(endPlain, startPlain) < 0) {
			throw new ValidationError({
				message: t("payroll.errors.endDateAfterStart", "End date must be on or after start date"),
				field: "endDate",
				value: request.endDate,
			});
		}
		return getPayrollReadiness({
			organizationId: actor.organizationId,
			period: {
				start: DateTime.fromISO(startPlain.toString(), { zone: "utc" }),
				end: DateTime.fromISO(endPlain.toString(), { zone: "utc" }),
			},
		});
	});
}

function parsePlainDateForAction(t: PayrollTranslate, value: string, field: string) {
	if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
		throw new ValidationError({
			message: t("payroll.errors.mustBeIsoDate", "{field} must be an ISO date", { field }),
			field,
			value,
		});
	}
	try {
		return parsePlainDate(value);
	} catch {
		throw new ValidationError({
			message: t("payroll.errors.mustBeValidIsoDate", "{field} must be a valid ISO date", {
				field,
			}),
			field,
			value,
		});
	}
}

export interface PayrollWorkspaceExportHistory {
	exports: PayrollExportJobSummary[];
	organizationTimezone: string;
}

/**
 * Export history for the `/payroll` Export tab (#1957): organization-wide for org
 * admins, strictly limited to jobs within the active payroll access grant for
 * delegated payroll officers. Denied to close-month-only actors.
 */
export async function getPayrollExportHistoryAction(): Promise<
	ServerActionResult<PayrollWorkspaceExportHistory>
> {
	return runPayrollWorkspaceAction(async (t) => {
		const actor = await requirePayrollWorkspaceActor(t);
		const fetchLimit = actor.isOrgAdmin
			? PAYROLL_EXPORT_HISTORY_LIMIT
			: PAYROLL_OFFICER_HISTORY_SCAN_LIMIT;
		const [[orgRow], jobs] = await Promise.all([
			db
				.select({ timezone: organization.timezone })
				.from(organization)
				.where(eq(organization.id, actor.organizationId))
				.limit(1),
			getExportJobHistory(actor.organizationId, fetchLimit),
		]);
		const organizationTimezone = resolveOrganizationTimezone(orgRow?.timezone).timezone;
		const exports = (await filterExportJobsForPayrollActor(actor, jobs)).slice(
			0,
			PAYROLL_EXPORT_HISTORY_LIMIT,
		);
		return { exports, organizationTimezone };
	});
}

/**
 * Presigned download URL for a completed payroll export job on `/payroll` (#1957).
 * Enforces the same actor scope check as `getPayrollExportHistoryAction`.
 */
export async function getPayrollExportDownloadUrlAction(
	jobId: string,
): Promise<ServerActionResult<string | null>> {
	return runPayrollWorkspaceAction(async (t) => {
		const actor = await requirePayrollWorkspaceActor(t);
		if (!z.uuid().safeParse(jobId).success) {
			return null;
		}
		const [job] = await db
			.select({
				id: payrollExportJob.id,
				organizationId: payrollExportJob.organizationId,
				filters: payrollExportJob.filters,
			})
			.from(payrollExportJob)
			.where(
				and(
					eq(payrollExportJob.id, jobId),
					eq(payrollExportJob.organizationId, actor.organizationId),
				),
			)
			.limit(1);
		if (!job) {
			return null;
		}
		if (!(await isExportJobInPayrollActorScope(actor, job))) {
			throw new AuthorizationError({
				message: t(
					"payroll.errors.exportOutOfScope",
					"This payroll export is outside your access scope",
				),
				userId: actor.userId,
				resource: "payroll_export",
				action: "read",
			});
		}
		return getExportDownloadUrl(actor.organizationId, job.id);
	});
}

async function filterExportJobsForPayrollActor<
	TJob extends { id: string; filters: PayrollExportJobSummary["filters"] },
>(actor: PayrollWorkspaceActor, jobs: TJob[]): Promise<TJob[]> {
	if (actor.isOrgAdmin || jobs.length === 0) {
		return jobs;
	}
	if (!actor.employeeId) {
		return [];
	}
	const grantScope = await getActivePayrollAccessGrantScope({
		organizationId: actor.organizationId,
		payrollEmployeeId: actor.employeeId,
	});
	if (!grantScope) {
		return [];
	}
	const jobIds = jobs.map((job) => job.id);
	const carriedRows = await db
		.select({
			jobId: payrollExportCarriedDay.jobId,
			employeeId: payrollExportCarriedDay.employeeId,
		})
		.from(payrollExportCarriedDay)
		.where(
			and(
				eq(payrollExportCarriedDay.organizationId, actor.organizationId),
				inArray(payrollExportCarriedDay.jobId, jobIds),
			),
		);
	const carriedByJob = new Map<string, Set<string>>();
	for (const row of carriedRows) {
		const set = carriedByJob.get(row.jobId) ?? new Set<string>();
		set.add(row.employeeId);
		carriedByJob.set(row.jobId, set);
	}
	const startDates = [...new Set(jobs.map((job) => job.filters.dateRange.start))];
	const periodActor = toPayrollPeriodActor(actor);
	const allowedByStart = new Map(
		await Promise.all(
			startDates.map(
				async (startDate) =>
					[
						startDate,
						new Set(await resolvePeriodEmployeeIds(actor.organizationId, periodActor, startDate)),
					] as const,
			),
		),
	);
	return jobs.filter((job) => {
		const allowed = allowedByStart.get(job.filters.dateRange.start) ?? new Set<string>();
		const carried = carriedByJob.get(job.id);
		if (carried && carried.size > 0) {
			if (allowed.size === 0 || !Array.from(carried).every((id) => allowed.has(id))) {
				return false;
			}
		}
		const explicitEmployeeIds = job.filters.employeeIds;
		const hasNonEmployeeFilters =
			(job.filters.teamIds?.length ?? 0) > 0 || (job.filters.projectIds?.length ?? 0) > 0;
		if (hasNonEmployeeFilters) {
			return grantScope === "all";
		}
		if (explicitEmployeeIds && explicitEmployeeIds.length > 0) {
			return allowed.size > 0 && explicitEmployeeIds.every((id) => allowed.has(id));
		}
		return grantScope === "all";
	});
}

async function isExportJobInPayrollActorScope(
	actor: PayrollWorkspaceActor,
	job: { id: string; filters: PayrollExportJobSummary["filters"] },
): Promise<boolean> {
	if (actor.isOrgAdmin) return true;
	const filtered = await filterExportJobsForPayrollActor(actor, [job]);
	return filtered.length === 1;
}

/**
 * The employees a payroll workspace export covers (#1001, #1957): org-wide for org
 * admins, active payroll access grant scope for delegated officers, plus covered
 * employees who left on or after the period's first day. An employee selection narrows
 * both.
 */
async function resolvePayrollExportScope(
	t: PayrollTranslate,
	request: PayrollWorkspaceRequest,
): Promise<{
	actor: PayrollWorkspaceActor;
	period: { start: DateTime; end: DateTime; label: string };
	employeeIds: string[];
}> {
	const actor = await requirePayrollWorkspaceActor(t);
	const period = validatePayrollWorkspaceRequest(t, request);
	const requestedEmployeeIds = validateRequestedEmployeeIds(t, request.employeeIds);
	const [allowedEmployeeIds, departedEmployeeIds] = await Promise.all([
		resolveActivePayrollEmployeesForActor(actor),
		listDepartedGrantEmployees(actor.organizationId, toPayrollPeriodActor(actor), {
			leftAfterStartOf: request.startDate,
		}),
	]);
	return {
		actor,
		period,
		employeeIds: intersectPayrollScope({
			allowedEmployeeIds: [...allowedEmployeeIds, ...departedEmployeeIds],
			requestedEmployeeIds,
		}),
	};
}

/** Active employees in the actor's payroll scope (org-wide for org admins, grant-scoped otherwise). */
async function resolveActivePayrollEmployeesForActor(
	actor: PayrollWorkspaceActor,
): Promise<string[]> {
	if (actor.isOrgAdmin) {
		return resolveOrganizationPayrollEmployeeIds(actor.organizationId);
	}
	if (!actor.employeeId) {
		return [];
	}
	return resolvePayrollAccessibleEmployeeIds({
		organizationId: actor.organizationId,
		payrollEmployeeId: actor.employeeId,
	});
}

/**
 * Resolves the signed-in payroll workspace actor (#1957):
 * 1. Organization administrators (with or without an employee record) get org-wide scope.
 * 2. Delegated payroll officers with an active employee profile and active payroll access grant
 *    get strictly their grant scope.
 * Close-month-only custom-role holders are deliberately rejected here so they cannot load
 * restricted payroll figures, settlement, or export actions.
 */
async function requirePayrollWorkspaceActor(t: PayrollTranslate): Promise<PayrollWorkspaceActor> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId;
	if (!authContext || !organizationId) {
		throw new AuthenticationError({
			message: t("payroll.errors.authenticationRequired", "Authentication required"),
		});
	}

	const isOrgAdmin = await isOrgAdminForOrganization(organizationId);

	if (isOrgAdmin) {
		const activeEmployee =
			authContext.employee?.organizationId === organizationId ? authContext.employee : null;
		return {
			organizationId,
			userId: authContext.user.id,
			employeeId: activeEmployee?.id ?? null,
			employeeRole: activeEmployee?.role ?? "admin",
			name: authContext.user.name || authContext.user.email,
			isOrgAdmin: true,
		};
	}

	if (!authContext.employee) {
		throw new AuthorizationError({
			message: t(
				"payroll.errors.noAssignedEmployees",
				"No payroll employees are assigned to your access scope",
			),
			userId: authContext.user.id,
			resource: "payroll_workspace",
			action: "read",
		});
	}

	if (authContext.employee.organizationId !== organizationId) {
		throw new AuthorizationError({
			message: t(
				"payroll.errors.activeOrganizationEmployeeRequired",
				"Active organization employee context is required",
			),
			userId: authContext.user.id,
			resource: "payroll_workspace",
			action: "read",
		});
	}

	const holdsGrant = await hasActivePayrollAccessGrant({
		organizationId,
		payrollEmployeeId: authContext.employee.id,
	});
	if (!holdsGrant) {
		throw new AuthorizationError({
			message: t(
				"payroll.errors.noAssignedEmployees",
				"No payroll employees are assigned to your access scope",
			),
			userId: authContext.user.id,
			resource: "payroll_workspace",
			action: "read",
		});
	}

	return {
		organizationId,
		userId: authContext.user.id,
		employeeId: authContext.employee.id,
		employeeRole: authContext.employee.role,
		name: authContext.user.name || authContext.user.email,
		isOrgAdmin: false,
	};
}

async function requireOrgAdminPayrollActor(t: PayrollTranslate): Promise<PayrollWorkspaceActor> {
	const actor = await requirePayrollWorkspaceActor(t);
	if (!actor.isOrgAdmin) {
		throw new AuthorizationError({
			message: t(
				"payroll.errors.orgAdminRequired",
				"Organization administrator access is required",
			),
			userId: actor.userId,
			resource: "payroll_readiness",
			action: "read",
		});
	}
	return actor;
}

/** An unconfirmed payroll run (#852) whose every included report is in the reader's payroll scope. */
export type ScopedPayrollRun = Omit<UnconfirmedPayrollRun, "employeeIds">;

/** The unconfirmed payroll runs the payroll actor may discard. */
export async function getScopedPayrollRunsAction(): Promise<
	ServerActionResult<ScopedPayrollRun[]>
> {
	return runPayrollWorkspaceAction(async (t) => {
		const actor = await requirePayrollWorkspaceActor(t);
		if (actor.isOrgAdmin) {
			const runs = await listUnconfirmedPayrollRuns(db, actor.organizationId);
			return runs.map(({ employeeIds: _employeeIds, ...run }) => run);
		}
		const { allowedEmployeeIds } = await resolvePayrollScopeOnly(t, actor);
		const runs = await listUnconfirmedPayrollRuns(db, actor.organizationId);
		const allowedEmployeeIdSet = new Set(allowedEmployeeIds);
		return runs
			.filter((run) => run.employeeIds.every((id) => allowedEmployeeIdSet.has(id)))
			.map(({ employeeIds: _employeeIds, ...run }) => run);
	});
}

/**
 * Discards an unconfirmed payroll run (#852) for a payroll actor: org admins may discard
 * any run in the organization; delegated payroll officers may discard only runs whose
 * included reports all belong to employees in their scope.
 */
export async function discardScopedPayrollRunAction(
	jobId: string,
): Promise<ServerActionResult<DiscardPayrollRunResult>> {
	return runPayrollWorkspaceAction(async (t) => {
		const actor = await requirePayrollWorkspaceActor(t);
		if (!z.uuid().safeParse(jobId).success) return { status: "not_found" } as const;
		const employeeScope = actor.isOrgAdmin
			? ("all" as const)
			: (await resolvePayrollScopeOnly(t, actor)).allowedEmployeeIds;
		const result = await discardPayrollRun(db, {
			organizationId: actor.organizationId,
			jobId,
			actorUserId: actor.userId,
			employeeScope,
		});
		if (result.status === "discarded") revalidatePath("/payroll");
		return result;
	});
}

/**
 * Payroll readiness for payroll runs (#854): the expense reports and legacy
 * claims awaiting reimbursement that an export of this period, format and
 * employee selection would not carry, limited to the reader's payroll scope.
 */
export async function getPayrollRunReadinessAction(
	request: PayrollWorkspaceRequest & { formatId: string },
): Promise<ServerActionResult<PayrollRunReadiness>> {
	return runPayrollWorkspaceAction(async (t) => {
		const formatId = validateExportFormatId(t, request.formatId);
		const { actor, scopedEmployeeIds } = await resolvePayrollWorkspaceActionContext(t, request);
		return getPayrollRunReadiness(db, {
			organizationId: actor.organizationId,
			formatId,
			// Validated above as exact ISO dates: the period's logical dates.
			period: {
				startDate: parsePlainDate(request.startDate).toString(),
				endDate: parsePlainDate(request.endDate).toString(),
			},
			employeeIds: scopedEmployeeIds,
		});
	});
}

/** The reader's whole payroll scope, for actions that concern no period. */
async function resolvePayrollScopeOnly(
	t: PayrollTranslate,
	authenticatedActor?: PayrollWorkspaceActor,
) {
	const { actor, scopedEmployeeIds } = await resolvePayrollWorkspaceActionContext(
		t,
		{
			startDate: "2000-01-01",
			endDate: "2000-01-01",
			label: t("payroll.export.formatAccessCheck", "Format access check"),
		},
		authenticatedActor,
	);
	return { actor, allowedEmployeeIds: scopedEmployeeIds };
}

export async function getConfiguredPayrollExportFormatsAction(): Promise<
	ServerActionResult<PayrollExportFormatOption[]>
> {
	return runPayrollWorkspaceAction(async (t) => {
		// Every org admin and active grant holder (including grants covering only former employees).
		const actor = await requirePayrollWorkspaceActor(t);

		const configuredFormats = await db
			.select({ id: payrollExportFormat.id, label: payrollExportFormat.name })
			.from(payrollExportConfig)
			.innerJoin(payrollExportFormat, eq(payrollExportConfig.formatId, payrollExportFormat.id))
			.where(
				and(
					eq(payrollExportConfig.organizationId, actor.organizationId),
					eq(payrollExportConfig.isActive, true),
					eq(payrollExportFormat.isEnabled, true),
					inArray(payrollExportFormat.id, payrollWorkspaceExportFormatIds()),
				),
			);

		return configuredFormats.map((format) => ({ id: format.id, label: format.label }));
	});
}

async function buildScopedPayrollWorkspaceSummary(
	t: PayrollTranslate,
	request: PayrollWorkspaceRequest,
): Promise<PayrollWorkspaceSummary> {
	const { actor, period, scopedEmployeeIds } = await resolvePayrollWorkspaceActionContext(
		t,
		request,
		undefined,
		{ includeDeparted: true },
	);

	return getPayrollWorkspaceSummary({
		organizationId: actor.organizationId,
		allowedEmployeeIds: scopedEmployeeIds,
		period,
		generatedBy: {
			id: actor.employeeId ?? actor.userId,
			name: actor.name,
		},
	});
}

async function resolvePayrollWorkspaceActionContext(
	t: PayrollTranslate,
	request: PayrollWorkspaceRequest,
	authenticatedActor?: PayrollWorkspaceActor,
	options: {
		/**
		 * Period reads (#1894) also cover covered employees who left during or after
		 * the period, as the export does; the period read keeps those with data in it.
		 */
		includeDeparted?: boolean;
	} = {},
): Promise<{
	actor: PayrollWorkspaceActor;
	period: { start: DateTime; end: DateTime; label: string };
	scopedEmployeeIds: string[];
}> {
	const actor = authenticatedActor ?? (await requirePayrollWorkspaceActor(t));
	const period = validatePayrollWorkspaceRequest(t, request);
	const requestedEmployeeIds = validateRequestedEmployeeIds(t, request.employeeIds);
	const [allowedEmployeeIds, departedEmployeeIds] = await Promise.all([
		resolveActivePayrollEmployeesForActor(actor),
		options.includeDeparted
			? listDepartedGrantEmployees(actor.organizationId, toPayrollPeriodActor(actor), {
					leftAfterStartOf: request.startDate,
				})
			: [],
	]);

	if (allowedEmployeeIds.length === 0) {
		if (actor.isOrgAdmin && requestedEmployeeIds === undefined) {
			return {
				actor,
				period,
				scopedEmployeeIds: [...departedEmployeeIds].toSorted(),
			};
		}
		throw new AuthorizationError({
			message: t(
				"payroll.errors.noAssignedEmployees",
				"No payroll employees are assigned to your access scope",
			),
			userId: actor.userId,
			resource: "payroll_workspace",
			action: "read",
		});
	}

	const scopedResult = resolveScopedPayrollEmployeeIdsForAction({
		role: actor.employeeRole,
		requestedEmployeeIds,
		allowedEmployeeIds: [...allowedEmployeeIds, ...departedEmployeeIds],
	});

	if (!scopedResult.hasScope) {
		throw new AuthorizationError({
			message: t(
				"payroll.errors.noAvailableEmployees",
				"No payroll employees are available in your access scope",
			),
			userId: actor.userId,
			resource: "payroll_workspace",
			action: "read",
		});
	}

	return {
		actor,
		period,
		scopedEmployeeIds: scopedResult.employeeIds,
	};
}

function validatePayrollBlockerDismissalRequest(
	t: PayrollTranslate,
	request: DismissPayrollBlockerRequest,
): { blockerId: string; blockerType: DismissiblePayrollBlockerType } {
	if (!z.uuid().safeParse(request.blockerId).success) {
		throw new ValidationError({
			message: t("payroll.errors.invalidBlockerId", "Invalid payroll blocker ID"),
			field: "blockerId",
		});
	}

	if (
		typeof request.blockerType !== "string" ||
		!PAYROLL_BLOCKER_TYPES.includes(request.blockerType as DismissiblePayrollBlockerType)
	) {
		throw new ValidationError({
			message: t("payroll.errors.invalidBlockerType", "Invalid payroll blocker type"),
			field: "blockerType",
		});
	}

	return { blockerId: request.blockerId, blockerType: request.blockerType };
}

function throwPayrollBlockerAuthorizationError(t: PayrollTranslate, userId: string): never {
	throw new AuthorizationError({
		message: t("payroll.errors.blockerNotDismissible", "Payroll blocker cannot be dismissed"),
		userId,
		resource: "payroll_workspace",
		action: "write",
	});
}

function validatePayrollWorkspaceRequest(
	t: PayrollTranslate,
	request: PayrollWorkspaceRequest,
): {
	start: DateTime;
	end: DateTime;
	label: string;
} {
	const start = parseISODate(t, request.startDate, "startDate");
	const end = parseISODate(t, request.endDate, "endDate");

	if (end < start) {
		throw new ValidationError({
			message: t("payroll.errors.endDateAfterStart", "End date must be on or after start date"),
			field: "endDate",
			value: request.endDate,
		});
	}

	if (typeof request.label !== "string" || request.label.trim().length === 0) {
		throw new ValidationError({
			message: t("payroll.errors.periodLabelRequired", "Payroll period label is required"),
			field: "label",
		});
	}

	return { start, end, label: request.label.trim() };
}

function parseISODate(t: PayrollTranslate, value: string, field: string): DateTime {
	if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
		throw new ValidationError({
			message: t("payroll.errors.mustBeIsoDate", "{field} must be an ISO date", { field }),
			field,
			value,
		});
	}

	const parsed = DateTime.fromISO(value, { zone: "utc" });
	if (!parsed.isValid || parsed.toISODate() !== value) {
		throw new ValidationError({
			message: t("payroll.errors.mustBeValidIsoDate", "{field} must be a valid ISO date", {
				field,
			}),
			field,
			value,
		});
	}

	return parsed;
}

function validateRequestedEmployeeIds(
	t: PayrollTranslate,
	employeeIds: string[] | undefined,
): string[] | undefined {
	if (employeeIds === undefined) return undefined;
	if (!Array.isArray(employeeIds)) {
		throw new ValidationError({
			message: t("payroll.errors.employeeIdsMustBeArray", "employeeIds must be an array"),
			field: "employeeIds",
		});
	}

	const uniqueEmployeeIds = [...new Set(employeeIds)];
	if (
		uniqueEmployeeIds.some((employeeId) => typeof employeeId !== "string" || !employeeId.trim())
	) {
		throw new ValidationError({
			message: t(
				"payroll.errors.employeeIdsMustContainOnlyStrings",
				"employeeIds must contain only strings",
			),
			field: "employeeIds",
		});
	}

	return uniqueEmployeeIds;
}

function validateExportFormatId(
	t: PayrollTranslate,
	formatId: string,
): PayrollWorkspaceExportFormatId {
	if (
		typeof formatId !== "string" ||
		!isPayrollWorkspaceExportFormatId(formatId) ||
		!getFormatter(formatId)
	) {
		throw new ValidationError({
			message: t("payroll.errors.unknownExportFormat", "Unknown payroll export format"),
			field: "formatId",
		});
	}

	return formatId;
}

async function runPayrollWorkspaceAction<T>(
	action: (t: PayrollTranslate) => Promise<T>,
): Promise<ServerActionResult<T>> {
	const t = await getTranslate();

	return runServerActionSafe(
		Effect.tryPromise({
			try: () => action(t),
			catch: (error) => mapPayrollWorkspaceActionError(error, t),
		}),
	);
}
