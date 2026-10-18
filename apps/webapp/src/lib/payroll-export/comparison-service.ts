import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { db } from "@/db";
import {
	absenceChangeRequest,
	auditLog,
	employee,
	payrollComparisonResult,
	payrollExportBaseline,
	payrollExportConfig,
	timeRecord,
} from "@/db/schema";
import { parseISO } from "@/lib/datetime/luxon-utils";
import {
	dateFromInstant,
	instantFromDate,
	parseInstant,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import { listDepartedEmployeesCoveredForExport } from "@/lib/payroll-access/adjustment-coverage";
import { readPayrollWorkCollectionFromSnapshot } from "@/lib/payroll-collection/payroll-work-collection-reader";
import {
	canReadScope,
	inspectPayrollBaseline,
	listPayrollBaselines,
	requireBaselineActor,
} from "./baseline-access";
import {
	collectPayrollBaselineWindows,
	comparisonErasureLock,
	payrollBaselineDetail,
	payrollBaselineDigest,
} from "./baseline-evidence";
import type {
	PayrollBaselineEvidence,
	PayrollBaselineSummary,
} from "./baseline-types";
import { workPeriodsFromCollectedInput } from "./collected-work";
import { payrollComparisonCsv } from "./comparison-csv";
import { readPayrollComparisonExplanations } from "./comparison-explanations";
import { comparePayrollOutput } from "./comparison-model";
import type {
	PayrollComparisonPreparation,
	ReviewedPayrollComparison,
} from "./comparison-types";

export type { PayrollComparisonPreparation } from "./comparison-types";

import { isReviewedPayrollComparison } from "./comparison-validation";
import {
	fetchAbsencesForExport,
	fetchOvertimePayoutsForExport,
	getWageTypeMappings,
} from "./data-fetcher";
import { exportedPersonnelIdentifier } from "./exported-personnel-identifier";
import { datevLohnFormatter } from "./formatters/datev-lohn-formatter";
import { lexwareLohnFormatter } from "./formatters/lexware-lohn-formatter";
import { sageLohnFormatter } from "./formatters/sage-lohn-formatter";
import {
	employeesWithoutIdentifier,
	findDuplicatePersonnelIdentifiers,
	payrollIdentifierCustomFieldId,
	withPersonnelIdentifiers,
} from "./personnel-identifier";
import {
	isSupportedPayrollFormat,
	payrollDestination,
	type SupportedPayrollFormatId,
	samePayrollDestination,
} from "./supported-format";
import type { PayrollExportFilters } from "./types";

export interface PayrollComparisonRequest {
	baselineId: string;
	formatId?: SupportedPayrollFormatId;
	startDate: string;
	endDate: string;
	employeeIds?: string[];
	teamIds?: string[];
	projectIds?: string[];
}
type Reader = Parameters<Parameters<typeof db.transaction>[0]>[0];
function sameSet(
	a: readonly string[] | undefined,
	b: readonly string[] | undefined,
) {
	return (
		JSON.stringify([...new Set(a ?? [])].sort()) ===
		JSON.stringify([...new Set(b ?? [])].sort())
	);
}
function validRequest(input: Omit<PayrollComparisonRequest, "baselineId">) {
	try {
		parsePlainDate(input.startDate);
		parsePlainDate(input.endDate);
		if (input.endDate < input.startDate) throw new Error();
		for (const ids of [input.employeeIds, input.teamIds, input.projectIds])
			if (
				ids !== undefined &&
				(!Array.isArray(ids) ||
					ids.some((id) => !z.uuid().safeParse(id).success))
			)
				throw new Error();
	} catch {
		throw new ValidationError({ message: "Invalid payroll comparison scope" });
	}
}
async function requestScope(
	actor: Awaited<ReturnType<typeof requireBaselineActor>>,
	request: Omit<PayrollComparisonRequest, "baselineId">,
) {
	validRequest(request);
	if (
		request.formatId !== undefined &&
		!isSupportedPayrollFormat(request.formatId)
	)
		throw new ValidationError({ message: "Invalid payroll format" });
	let selected: string[];
	if (request.employeeIds !== undefined) {
		if (!(await canReadScope(actor, request.employeeIds, request.startDate)))
			return null;
		selected = [...new Set(request.employeeIds)].sort();
	} else
		selected = [
			...new Set([
				...actor.activeScope,
				...(await listDepartedEmployeesCoveredForExport(db, {
					organizationId: actor.organizationId,
					actorUserId: actor.userId,
					fromDate: request.startDate,
				})),
			]),
		].sort();
	if (!selected.length || !request.teamIds?.length) return selected;
	const rows = await db
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, actor.organizationId),
				inArray(employee.id, selected),
				inArray(employee.teamId, request.teamIds),
			),
		);
	return rows.map((row) => row.id).sort();
}
/** Metadata listing never defaults to another destination, period or scope. */
export async function listCompatiblePayrollBaselines(
	request: Omit<PayrollComparisonRequest, "baselineId">,
): Promise<PayrollBaselineSummary[]> {
	const actor = await requireBaselineActor();
	const scope = await requestScope(actor, request);
	if (!scope) return [];
	const rows = await listPayrollBaselines(request);
	const selected: PayrollBaselineSummary[] = [];
	for (const summary of rows) {
		if (
			!sameSet(summary.employeeIds, scope) ||
			!["available", "empty"].includes(summary.availability)
		)
			continue;
		const detail = await inspectPayrollBaseline(summary.id);
		if (!detail?.evidence) continue;
		const historical = detail.evidence;
		if (
			!sameSet(request.teamIds, historical.filters.teamIds) ||
			!sameSet(request.projectIds, historical.filters.projectIds)
		)
			continue;
		const compatible = await db.transaction(
			(tx) => checkCompatibility(tx, actor.organizationId, historical, scope),
			{ isolationLevel: "repeatable read", accessMode: "read only" },
		);
		if (compatible === null) selected.push(summary);
	}
	return selected;
}
async function checkCompatibility(
	reader: Reader,
	organizationId: string,
	evidence: PayrollBaselineEvidence,
	scope: string[],
): Promise<string | null> {
	if (!sameSet(evidence.employeeIds, scope)) return "employee_scope_changed";
	const current = await reader.query.payrollExportConfig.findFirst({
		where: and(
			eq(payrollExportConfig.organizationId, organizationId),
			eq(payrollExportConfig.formatId, evidence.output.formatId),
			eq(payrollExportConfig.isActive, true),
		),
	});
	if (!current) return "destination_unavailable";
	const config = current.config as Record<string, unknown>;
	if (
		!samePayrollDestination(
			evidence.output.formatId,
			payrollDestination(evidence.output.formatId, current.id, config),
			evidence.destination,
		)
	)
		return "destination_changed";
	const windows = await collectPayrollBaselineWindows(reader, {
		organizationId,
		employeeIds: scope,
		filters: evidence.filters,
	});
	const canonicalWindows = (rows: PayrollBaselineEvidence["employeeWindows"]) =>
		rows
			.map(({ employeeId, startUtc, endExclusiveUtc }) => ({
				employeeId,
				startUtc: parseInstant(startUtc).toString(),
				endExclusiveUtc: parseInstant(endExclusiveUtc).toString(),
			}))
			.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
	if (
		JSON.stringify(canonicalWindows(windows)) !==
		JSON.stringify(canonicalWindows(evidence.employeeWindows))
	)
		return "employee_windows_changed";
	return null;
}
/** Prepares every live input in one read-only repeatable-read snapshot. */
export async function preparePayrollComparison(
	request: PayrollComparisonRequest,
): Promise<PayrollComparisonPreparation> {
	const actor = await requireBaselineActor();
	const scope = await requestScope(actor, request);
	if (!scope || !z.uuid().safeParse(request.baselineId).success)
		return { status: "unavailable" };
	const baseline = await inspectPayrollBaseline(request.baselineId);
	if (!baseline?.evidence) return { status: "unavailable" };
	const evidence = baseline.evidence;
	if (request.formatId && request.formatId !== evidence.output.formatId)
		return { status: "incompatible", reason: "format_changed" };
	const formatter = {
		datev_lohn: datevLohnFormatter,
		lexware_lohn: lexwareLohnFormatter,
		sage_lohn: sageLohnFormatter,
	}[evidence.output.formatId];
	if (
		!sameSet(request.teamIds, evidence.filters.teamIds) ||
		!sameSet(request.projectIds, evidence.filters.projectIds)
	)
		return { status: "incompatible", reason: "effective_filters_changed" };
	if (
		request.startDate !== evidence.period.startDate ||
		request.endDate !== evidence.period.endDate
	)
		return { status: "incompatible", reason: "period_changed" };
	const preview = await db
		.transaction(
			async (reader) => {
				// Establish snapshot before recording its preparation time.
				await reader
					.select({ id: employee.id })
					.from(employee)
					.where(eq(employee.organizationId, actor.organizationId))
					.limit(1);
				const preparedAt = systemClock.nowInstant();
				const incompatibility = await checkCompatibility(
					reader,
					actor.organizationId,
					evidence,
					scope,
				);
				if (incompatibility)
					return { status: "incompatible", reason: incompatibility } as const;
				const current = await reader.query.payrollExportConfig.findFirst({
					where: and(
						eq(payrollExportConfig.organizationId, actor.organizationId),
						eq(payrollExportConfig.formatId, evidence.output.formatId),
						eq(payrollExportConfig.isActive, true),
					),
				});
				if (!current)
					return {
						status: "incompatible",
						reason: "destination_unavailable",
					} as const;
				const config = current.config as Record<string, unknown>;
				const validity = formatter.validateConfig(config);
				if (!validity.valid)
					return {
						status: "blocked",
						blockers: [
							{
								employeeId: "",
								reason: "invalid_configuration",
								message: validity.errors?.join("; "),
							},
						],
					} as const;
				const filters: PayrollExportFilters = {
					dateRange: {
						start: parseISO(evidence.period.startDate, "utc"),
						end: parseISO(evidence.period.endDate, "utc"),
					},
					employeeIds: scope,
					teamIds: evidence.filters.teamIds,
					projectIds: evidence.filters.projectIds,
				};
				const identifier = payrollIdentifierCustomFieldId(config);
				const absenceBlockers = await readPendingAbsenceBlockers(
					reader,
					actor.organizationId,
					scope,
					evidence.period,
				);
				if (absenceBlockers.length)
					return { status: "blocked", blockers: absenceBlockers } as const;
				const absences = await fetchAbsencesForExport(
					actor.organizationId,
					filters,
					{ canonicalReadiness: "absences", reader },
				);
				const payouts = await fetchOvertimePayoutsForExport(
					actor.organizationId,
					filters,
					reader,
				);
				const collection = await readPayrollWorkCollectionFromSnapshot(
					reader,
					actor.organizationId,
					{
						...evidence.period,
						employeeIds: scope,
						teamIds: evidence.filters.teamIds,
						projectIds: evidence.filters.projectIds,
					},
					{
						personnelIdentifier:
							identifier === null
								? null
								: {
										customFieldId: identifier,
										employeesWithOtherRows: [...absences, ...payouts].map(
											(row) => row.employeeId,
										),
									},
					},
				);
				if (!sameSet(collection.input.scope.employeeIds, scope))
					return {
						status: "incompatible",
						reason: "effective_filters_changed",
					} as const;
				if (collection.blockers.length)
					return {
						status: "blocked",
						blockers: collection.blockers.map((blocker) => ({
							employeeId: blocker.employeeId,
							reason: blocker.reason ?? blocker.kind,
						})),
					} as const;
				const values = collection.input.personnelIdentifier?.values ?? {};
				const work = workPeriodsFromCollectedInput(collection.input);
				const rows = [...work, ...absences, ...payouts];
				const missing =
					identifier === null ? [] : employeesWithoutIdentifier(rows, values);
				if (missing.length)
					return {
						status: "blocked",
						blockers: missing.map((employeeId) => ({
							employeeId,
							reason: "missing_personnel_identifier",
						})),
					} as const;
				const apply = <T extends { employeeId: string }>(rows: T[]) =>
					identifier === null ? rows : withPersonnelIdentifiers(rows, values);
				const identifierOf = exportedPersonnelIdentifier(
					evidence.output.formatId,
					config,
				);
				if (!identifierOf)
					throw new Error("Payroll identifier rule unavailable");
				const clashes = findDuplicatePersonnelIdentifiers(
					apply(rows),
					identifierOf,
				);
				if (clashes.length)
					return {
						status: "blocked",
						blockers: clashes.flatMap((clash) =>
							clash.employees.map((row) => ({
								employeeId: row.employeeId,
								reason: "duplicate_personnel_identifier",
							})),
						),
					} as const;
				const mappings = await getWageTypeMappings(
					actor.organizationId,
					reader,
				);
				const formatted = formatter.transform(
					apply(work),
					apply(absences),
					[],
					mappings,
					config,
					apply(payouts),
				);
				if (formatted.metadata.unmappedOvertimePayouts.length)
					return {
						status: "blocked",
						blockers: formatted.metadata.unmappedOvertimePayouts.map((row) => ({
							employeeId: row.employeeId,
							reason: "unmapped_overtime_payout",
						})),
					} as const;
				if (!formatted.supportedOutputEvidence)
					throw new Error("Formatter output evidence unavailable");
				return {
					status: "ready",
					preparedAt,
					output: formatted.supportedOutputEvidence,
					explanations: await readPayrollComparisonExplanations(reader, {
						organizationId: actor.organizationId,
						baseline: evidence,
						baselineCompletedAt: baseline.summary.completedAt,
						current: formatted.supportedOutputEvidence,
					}),
				} as const;
			},
			{ isolationLevel: "repeatable read", accessMode: "read only" },
		)
		.catch((error) => {
			if (
				error instanceof Error &&
				error.name === "CanonicalCutoverNotReadyError"
			)
				return {
					status: "blocked",
					blockers: [{ employeeId: "", reason: "absence_readiness" }],
				} as const;
			throw error;
		});
	if (preview.status === "blocked")
		return { status: "blocked", blockers: [...preview.blockers] };
	if (preview.status !== "ready") return preview;
	const expires = preview.preparedAt.add({ hours: 24 });
	const expiresAt =
		Temporal.Instant.compare(
			expires,
			parseInstant(baseline.summary.expiresAt),
		) < 0
			? expires
			: parseInstant(baseline.summary.expiresAt);
	const result: ReviewedPayrollComparison = {
		id: randomUUID(),
		baseline: baseline.summary,
		preparedAt: preview.preparedAt.toString(),
		expiresAt: expiresAt.toString(),
		filters: evidence.filters,
		comparison: comparePayrollOutput(evidence.output, preview.output),
		explanations: preview.explanations,
	};
	// Serialize retention with explicit erasure and recheck actor access after preparation.
	const freshActor = await requireBaselineActor();
	if (
		freshActor.organizationId !== actor.organizationId ||
		!(await canReadScope(freshActor, scope, evidence.period.startDate))
	)
		return { status: "unavailable" };
	const retained = await db.transaction(async (tx) => {
		await comparisonErasureLock(tx, actor.organizationId);
		const row = await tx.query.payrollExportBaseline.findFirst({
			where: and(
				eq(payrollExportBaseline.organizationId, actor.organizationId),
				eq(payrollExportBaseline.id, baseline.summary.id),
			),
		});
		if (!row || !payrollBaselineDetail(row, systemClock.nowInstant()).evidence)
			return false;
		await tx.insert(payrollComparisonResult).values({
			id: result.id,
			organizationId: actor.organizationId,
			baselineId: baseline.summary.id,
			digest: payrollBaselineDigest(result),
			result,
			expiresAt: dateFromInstant(expiresAt),
		});
		await tx.insert(auditLog).values({
			organizationId: actor.organizationId,
			performedBy: actor.userId,
			entityType: "payroll_comparison",
			entityId: result.id,
			action: "payroll_comparison.prepare",
			metadata: JSON.stringify({ baselineId: baseline.summary.id }),
		});
		return true;
	});
	return retained ? { status: "ready", result } : { status: "unavailable" };
}
async function readReviewedPayrollComparison(
	id: string,
	action: "view" | "download",
): Promise<ReviewedPayrollComparison | null> {
	const actor = await requireBaselineActor();
	if (!z.uuid().safeParse(id).success) return null;
	const row = await db.query.payrollComparisonResult.findFirst({
		where: and(
			eq(payrollComparisonResult.organizationId, actor.organizationId),
			eq(payrollComparisonResult.id, id),
		),
	});
	if (
		!row ||
		Temporal.Instant.compare(
			instantFromDate(row.expiresAt),
			systemClock.nowInstant(),
		) <= 0
	)
		return null;
	const baseline = await inspectPayrollBaseline(row.baselineId);
	if (!baseline?.evidence) return null;
	if (
		!isReviewedPayrollComparison(row.result) ||
		payrollBaselineDigest(row.result) !== row.digest ||
		row.result.id !== id ||
		row.result.baseline.id !== baseline.summary.id ||
		!sameSet(row.result.baseline.employeeIds, baseline.evidence.employeeIds)
	)
		return null;
	await db.insert(auditLog).values({
		organizationId: actor.organizationId,
		performedBy: actor.userId,
		entityType: "payroll_comparison",
		entityId: id,
		action: `payroll_comparison.${action}`,
	});
	return row.result;
}
export async function getPayrollComparison(
	id: string,
): Promise<ReviewedPayrollComparison | null> {
	return readReviewedPayrollComparison(id, "view");
}
export async function downloadPayrollComparison(
	id: string,
): Promise<{ fileName: string; content: string } | null> {
	const result = await readReviewedPayrollComparison(id, "download");
	if (!result) return null;
	return {
		fileName: `payroll-comparison-${id}.csv`,
		content: payrollComparisonCsv(result),
	};
}
export async function cleanupExpiredPayrollComparisons() {
	return db
		.delete(payrollComparisonResult)
		.where(
			lte(
				payrollComparisonResult.expiresAt,
				dateFromInstant(systemClock.nowInstant()),
			),
		)
		.returning({ id: payrollComparisonResult.id });
}

/** Pending absence decisions are unresolved payroll input, including proposals that move into the period. */
async function readPendingAbsenceBlockers(
	reader: Reader,
	organizationId: string,
	scope: string[],
	period: PayrollBaselineEvidence["period"],
) {
	if (!scope.length) return [];
	const start = dateFromInstant(
		parsePlainDate(period.startDate).toZonedDateTime("UTC").toInstant(),
	);
	const end = dateFromInstant(
		parsePlainDate(period.endDate)
			.add({ days: 1 })
			.toZonedDateTime("UTC")
			.toInstant(),
	);
	const pending = await reader
		.select({ employeeId: timeRecord.employeeId })
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.organizationId, organizationId),
				inArray(timeRecord.employeeId, scope),
				eq(timeRecord.recordKind, "absence"),
				inArray(timeRecord.approvalState, ["pending", "draft"]),
				lt(timeRecord.startAt, end),
				or(isNull(timeRecord.endAt), gte(timeRecord.endAt, start)),
			),
		);
	const changes = await reader
		.select({ employeeId: absenceChangeRequest.employeeId })
		.from(absenceChangeRequest)
		.where(
			and(
				eq(absenceChangeRequest.organizationId, organizationId),
				inArray(absenceChangeRequest.employeeId, scope),
				eq(absenceChangeRequest.status, "pending"),
				sql`(
 (${absenceChangeRequest.original}->>'startDate' <= ${period.endDate} AND ${absenceChangeRequest.original}->>'endDate' >= ${period.startDate}) OR
 (${absenceChangeRequest.proposed}->>'startDate' <= ${period.endDate} AND ${absenceChangeRequest.proposed}->>'endDate' >= ${period.startDate}) OR
 ${absenceChangeRequest.original}->>'startDate' IS NULL
 )`,
			),
		);
	return [
		...pending.map((row) => ({
			employeeId: row.employeeId,
			reason: "pending_absence",
			message:
				"Review and decide the pending absence in the Absences workspace.",
		})),
		...changes.map((row) => ({
			employeeId: row.employeeId,
			reason: "pending_absence_change",
			message:
				"Review and decide the pending absence change or cancellation in the Absences workspace.",
		})),
	];
}
