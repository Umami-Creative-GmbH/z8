import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	employee,
	payrollComparisonResult,
	payrollExportBaseline,
	payrollExportBaselineWindowInput,
	payrollExportComparisonErasure,
	payrollExportJob,
} from "@/db/schema";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { employeePayrollWindow } from "@/lib/payroll-allocation/protected-minutes";
import { canonicalJson } from "@/lib/time-tracking/canonical-json";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import type {
	PayrollBaselineDetail,
	PayrollBaselineEvidence,
} from "./baseline-types";
import type { SerializedPayrollExportFilters } from "./types";
export type BaselineDatabase = Pick<
	typeof db,
	"select" | "insert" | "update" | "delete" | "query" | "execute"
>;
export const BASELINE_EVIDENCE_VERSION = 1;
export function payrollBaselineDigest(evidence: unknown): string {
	return createHash("sha256").update(canonicalJson(evidence)).digest("hex");
}
export function payrollBaselineExpiry(completedAt: Instant): Instant {
	return completedAt.toZonedDateTimeISO("UTC").add({ months: 24 }).toInstant();
}

/** Resolve full employee scope and explicit windows, before formatting the successful attempt. */
export async function collectPayrollBaselineWindows(
	database: BaselineDatabase,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		filters: SerializedPayrollExportFilters;
	},
): Promise<PayrollBaselineEvidence["employeeWindows"]> {
	const ids = [...new Set(input.employeeIds)].sort();
	if (ids.length === 0) return [];
	const [org, employees] = await Promise.all([
		database.query.organization.findFirst({
			where: eq(organization.id, input.organizationId),
			columns: { timezone: true },
		}),
		database.query.employee.findMany({
			where: and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, ids),
			),
			columns: { id: true },
			with: { userSettings: { columns: { timezone: true } } },
		}),
	]);
	if (employees.length !== ids.length)
		throw new Error("Payroll scope is unavailable");
	return employees
		.map((row) => {
			const timezone = resolveEffectiveTimezone(
				row.userSettings?.timezone,
				org?.timezone,
			);
			const window = employeePayrollWindow(
				input.filters.dateRange.start,
				input.filters.dateRange.end,
				timezone,
			);
			return {
				employeeId: row.id,
				timezone,
				startUtc: window.start.toString(),
				endExclusiveUtc: window.endExclusive.toString(),
			};
		})
		.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}
export async function insertPayrollBaseline(
	database: BaselineDatabase & Pick<typeof db, "transaction">,
	input: {
		id: string;
		jobId: string;
		organizationId: string;
		createdAt: Date;
		completedAt: Date;
		evidence: PayrollBaselineEvidence;
	},
): Promise<void> {
	// Normalize to the JSONB wire representation before hashing: optional undefined keys are omitted by storage.
	const serializedEvidence = JSON.stringify(input.evidence);
	const evidence: PayrollBaselineEvidence = JSON.parse(serializedEvidence);
	const expiresAt = dateFromInstant(
		payrollBaselineExpiry(instantFromDate(input.completedAt)),
	);
	await database.transaction(async (tx) => {
		await comparisonErasureLock(tx, input.organizationId);
		const erased = await tx.query.payrollExportComparisonErasure.findFirst({
			where: and(
				eq(payrollExportComparisonErasure.organizationId, input.organizationId),
				eq(payrollExportComparisonErasure.jobId, input.jobId),
			),
		});
		await tx.insert(payrollExportBaseline).values({
			id: input.id,
			jobId: input.jobId,
			organizationId: input.organizationId,
			descriptor: {
				destination: evidence.destination,
				formatId: evidence.output.formatId,
				period: evidence.period,
			},
			version: BASELINE_EVIDENCE_VERSION,
			digest: erased ? "erased" : payrollBaselineDigest(evidence),
			scopeEmployeeIds: evidence.employeeIds,
			evidence: erased ? null : evidence,
			unavailableReason: erased ? "erased" : null,
			createdAt: input.createdAt,
			completedAt: input.completedAt,
			expiresAt,
		});
	});
}

/** Serializes completion with explicit erasure so an in-flight attempt cannot resurrect its payload. */
export async function comparisonErasureLock(
	database: Pick<BaselineDatabase, "execute">,
	organizationId: string,
) {
	await database.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`payroll-comparison-erasure:${organizationId}`},0))`,
	);
}
export async function readPayrollBaseline(
	input: {
		organizationId: string;
		baselineId?: string;
		jobId?: string;
		now?: Instant;
	},
	database: BaselineDatabase = db,
): Promise<PayrollBaselineDetail | null> {
	const row = await database.query.payrollExportBaseline.findFirst({
		where: and(
			eq(payrollExportBaseline.organizationId, input.organizationId),
			input.baselineId
				? eq(payrollExportBaseline.id, input.baselineId)
				: eq(
						payrollExportBaseline.jobId,
						input.jobId ?? "00000000-0000-0000-0000-000000000000",
					),
		),
		orderBy: [
			desc(payrollExportBaseline.completedAt),
			desc(payrollExportBaseline.id),
		],
	});
	if (!row) return null;
	return payrollBaselineDetail(row, input.now ?? systemClock.nowInstant());
}

const retainedId = z.string().min(1);
const retainedNullableText = z.string().nullable();
const retainedDay = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((value) => {
		try {
			Temporal.PlainDate.from(value);
			return true;
		} catch {
			return false;
		}
	});
const retainedUtc = z.string().refine((value) => {
	try {
		return value.endsWith("Z") && Boolean(Temporal.Instant.from(value));
	} catch {
		return false;
	}
});
const retainedDestination = z.object({
	configId: retainedId,
	mandantennummer: z.string(),
	beraternummer: z.string(),
});
const retainedPeriod = z.object({
	startDate: retainedDay,
	endDate: retainedDay,
});
const retainedFormat = z.enum(["datev_lohn", "lexware_lohn", "sage_lohn"]);
const retainedMonth = z
	.string()
	.regex(/^\d{4}-\d{2}$/)
	.refine((value) => {
		try {
			Temporal.PlainYearMonth.from(value);
			return true;
		} catch {
			return false;
		}
	});
const retainedDescriptor = z.object({
	formatId: retainedFormat.optional(),
	destination: retainedDestination,
	period: retainedPeriod,
});
const retainedContributionIdentity = {
	sourceId: retainedId,
	sourceRevision: retainedNullableText,
	sourceActorId: retainedNullableText.optional(),
	employeeId: retainedId,
	firstName: retainedNullableText,
	lastName: retainedNullableText,
	hours: z.number().finite(),
	reason: retainedNullableText,
};
const retainedContribution = z.discriminatedUnion("kind", [
	z.object({
		...retainedContributionIdentity,
		kind: z.literal("work"),
		facts: z.object({
			startAt: retainedUtc.nullable(),
			endAt: retainedUtc.nullable(),
			durationMinutes: z.number().finite(),
			workCategoryId: retainedNullableText,
			workCategoryName: retainedNullableText,
			projectId: retainedNullableText,
			projectName: retainedNullableText,
			mappingId: retainedNullableText,
		}),
	}),
	z.object({
		...retainedContributionIdentity,
		kind: z.literal("absence"),
		facts: z.object({
			startDate: retainedDay,
			endDate: retainedDay,
			absenceCategoryId: retainedId,
			absenceCategoryName: retainedNullableText,
			absenceType: retainedNullableText,
			status: z.string(),
			mappingId: retainedId,
		}),
	}),
	z.object({
		...retainedContributionIdentity,
		kind: z.literal("overtime_payout"),
		facts: z.object({
			day: retainedDay,
			minutes: z.number().finite(),
			mappingId: retainedNullableText,
		}),
	}),
]);
const retainedEvidence = z.object({
	version: z.literal(1),
	destination: retainedDestination,
	config: z.record(z.string(), z.unknown()),
	filters: z.object({
		dateRange: z.object({ start: retainedId, end: retainedId }),
		employeeIds: z.array(retainedId).optional(),
		teamIds: z.array(retainedId).optional(),
		projectIds: z.array(retainedId).optional(),
	}),
	period: retainedPeriod,
	employeeIds: z.array(retainedId),
	employeeWindowsUnavailable: z.literal(true).optional(),
	employeeWindows: z.array(
		z.object({
			employeeId: retainedId,
			timezone: retainedId,
			startUtc: retainedUtc,
			endExclusiveUtc: retainedUtc,
		}),
	),
	output: z.object({
		version: z.literal(1),
		formatId: retainedFormat,
		formatterVersion: retainedId,
		excludedLineKinds: z.tuple([z.literal("expense")]),
		rows: z.array(
			z.object({
				personnelNumber: z.string(),
				wageTypeCode: z.string(),
				date: z.union([retainedDay, retainedMonth]),
				quantity: z.string().regex(/^-?\d+\.\d{2}$/),
				unit: z.literal("hours"),
				note: z.string(),
				renderedColumns: z.record(z.string(), z.string()).optional(),
				contributions: z.array(retainedContribution).min(1),
			}),
		),
	}),
	fileDigest: z.string().regex(/^[a-f0-9]{64}$/),
	attemptId: retainedId,
});

function sameUniqueScope(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		new Set(left).size === left.length &&
		new Set(right).size === right.length &&
		canonicalJson([...left].sort()) === canonicalJson([...right].sort())
	);
}
function dateIsoOrEmpty(value: Date): string {
	return value instanceof Date && Number.isFinite(value.getTime())
		? value.toISOString()
		: "";
}
function recordValue(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** Checks the retained payload without consulting current source records or timezone preferences. */
function retainedAvailability(
	row: typeof payrollExportBaseline.$inferSelect,
	now: Instant,
): PayrollBaselineDetail["summary"]["availability"] {
	try {
		const expectedExpiry = payrollBaselineExpiry(
			instantFromDate(row.completedAt),
		);
		const storedExpiry = instantFromDate(row.expiresAt);
		if (
			Temporal.Instant.compare(now, expectedExpiry) >= 0 ||
			Temporal.Instant.compare(now, storedExpiry) >= 0
		)
			return "expired";
		if (Temporal.Instant.compare(expectedExpiry, storedExpiry) !== 0)
			return "corrupt";
		if (
			row.unavailableReason === "expired" ||
			row.unavailableReason === "erased"
		)
			return row.unavailableReason;
		if (row.unavailableReason !== null) return "corrupt";
		const payload = recordValue(row.evidence);
		if (!payload || payrollBaselineDigest(payload) !== row.digest)
			return "corrupt";
		const output = recordValue(payload.output);
		if (
			typeof payload.version !== "number" ||
			!Number.isInteger(payload.version) ||
			payload.version < 1 ||
			row.version !== payload.version
		)
			return "corrupt";
		if (payload.version !== BASELINE_EVIDENCE_VERSION)
			return "unsupported_version";
		if (
			!output ||
			typeof output.version !== "number" ||
			!Number.isInteger(output.version) ||
			output.version < 1
		)
			return "corrupt";
		if (output.version !== 1) return "unsupported_version";
		const parsed = retainedEvidence.safeParse(payload);
		const descriptor = retainedDescriptor.safeParse(row.descriptor);
		const scope = z.array(retainedId).safeParse(row.scopeEmployeeIds);
		if (!parsed.success || !descriptor.success || !scope.success)
			return "corrupt";
		const evidence = parsed.data;
		if (
			canonicalJson({
				destination: descriptor.data.destination,
				period: descriptor.data.period,
			}) !==
				canonicalJson({
					destination: evidence.destination,
					period: evidence.period,
				}) ||
			!sameUniqueScope(scope.data, evidence.employeeIds)
		)
			return "corrupt";
		if (
			(descriptor.data.formatId ?? "datev_lohn") !== evidence.output.formatId ||
			evidence.output.rows.some(
				(line) =>
					!(
						evidence.output.formatId === "lexware_lohn"
							? retainedMonth
							: retainedDay
					).safeParse(line.date).success,
			)
		)
			return "corrupt";
		if (
			evidence.output.formatId === "datev_lohn" &&
			(!evidence.destination.mandantennummer ||
				!evidence.destination.beraternummer)
		)
			return "corrupt";
		const employees = new Set(evidence.employeeIds);
		if (
			evidence.output.rows.some((line) =>
				line.contributions.some(
					(contribution) => !employees.has(contribution.employeeId),
				),
			)
		)
			return "corrupt";
		if (
			evidence.period.startDate > evidence.period.endDate ||
			evidence.filters.dateRange.start.slice(0, 10) !==
				evidence.period.startDate ||
			evidence.filters.dateRange.end.slice(0, 10) !== evidence.period.endDate
		)
			return "corrupt";
		if (evidence.employeeWindowsUnavailable)
			return evidence.employeeWindows.length === 0 ? "legacy" : "corrupt";
		if (
			!sameUniqueScope(
				evidence.employeeIds,
				evidence.employeeWindows.map((window) => window.employeeId),
			)
		)
			return "corrupt";
		if (
			evidence.employeeWindows.some(
				(window) =>
					Temporal.Instant.compare(
						Temporal.Instant.from(window.startUtc),
						Temporal.Instant.from(window.endExclusiveUtc),
					) >= 0,
			)
		)
			return "corrupt";
		return evidence.output.rows.length ? "available" : "empty";
	} catch {
		return "corrupt";
	}
}

export function payrollBaselineDetail(
	row: typeof payrollExportBaseline.$inferSelect,
	now: Instant,
): PayrollBaselineDetail {
	const availability = retainedAvailability(row, now);
	const descriptor = retainedDescriptor.safeParse(row.descriptor);
	const scope = z.array(retainedId).safeParse(row.scopeEmployeeIds);
	const available = availability === "available" || availability === "empty";
	return {
		summary: {
			id: row.id,
			jobId: row.jobId,
			formatId: descriptor.success
				? (descriptor.data.formatId ?? "datev_lohn")
				: "datev_lohn",
			destination: descriptor.success
				? descriptor.data.destination
				: { configId: "", mandantennummer: "", beraternummer: "" },
			period: descriptor.success
				? descriptor.data.period
				: { startDate: "", endDate: "" },
			employeeIds: scope.success && availability !== "erased" ? scope.data : [],
			createdAt: dateIsoOrEmpty(row.createdAt),
			completedAt: dateIsoOrEmpty(row.completedAt),
			expiresAt: dateIsoOrEmpty(row.expiresAt),
			availability,
		},
		evidence: available ? row.evidence : null,
	};
}
/** Idempotent sweep deletes only the sensitive comparison payload; files keep their existing policy. */
export async function cleanupExpiredPayrollBaselines(
	input: { now?: Instant } = {},
	database: BaselineDatabase = db,
): Promise<number> {
	const rows = await database
		.update(payrollExportBaseline)
		.set({ evidence: null, unavailableReason: "expired" })
		.where(
			and(
				lte(
					payrollExportBaseline.expiresAt,
					dateFromInstant(
						(input.now ?? systemClock.nowInstant()).round({
							smallestUnit: "millisecond",
							roundingMode: "floor",
						}),
					),
				),
				isNotNull(payrollExportBaseline.evidence),
			),
		)
		.returning({ id: payrollExportBaseline.id });
	// Frozen windows exist to interpret retry input; remove them once every retained attempt expired.
	await database.delete(payrollExportBaselineWindowInput).where(sql`
  exists(select 1 from payroll_export_baseline b
   where b.organization_id=${payrollExportBaselineWindowInput.organizationId} and b.job_id=${payrollExportBaselineWindowInput.jobId})
  and not exists(select 1 from payroll_export_baseline b
   where b.organization_id=${payrollExportBaselineWindowInput.organizationId} and b.job_id=${payrollExportBaselineWindowInput.jobId}
    and b.expires_at > ${dateFromInstant((input.now ?? systemClock.nowInstant()).round({ smallestUnit: "millisecond", roundingMode: "floor" }))})
 `);
	return rows.length;
}
/** Explicit erasure with an employee still present: erase the complete payload, never alter a row quantity. */
export async function eraseEmployeePayrollBaselines(
	database: BaselineDatabase,
	input: { organizationId: string; employeeId: string },
): Promise<number> {
	if ("transaction" in database && typeof database.transaction === "function") {
		return database.transaction((tx: BaselineDatabase) =>
			eraseEmployeePayrollBaselinesInTransaction(tx, input),
		);
	}
	return eraseEmployeePayrollBaselinesInTransaction(database, input);
}

/** A sealed work-transaction client deliberately exposes no nested transaction method. */
async function eraseEmployeePayrollBaselinesInTransaction(
	tx: BaselineDatabase,
	input: { organizationId: string; employeeId: string },
): Promise<number> {
	await comparisonErasureLock(tx, input.organizationId);
	const [baselines, jobs] = await Promise.all([
		tx.query.payrollExportBaseline.findMany({
			where: eq(payrollExportBaseline.organizationId, input.organizationId),
		}),
		tx.query.payrollExportJob.findMany({
			where: eq(payrollExportJob.organizationId, input.organizationId),
			columns: { id: true, filters: true },
		}),
	]);
	const affected = baselines.filter(
		(row) =>
			!Array.isArray(row.scopeEmployeeIds) ||
			row.scopeEmployeeIds.includes(input.employeeId),
	);
	// Unresolved legacy scopes are conservatively redacted; current records cannot prove historical membership.
	const affectedJobs = jobs.filter(
		(job) =>
			!Array.isArray(job.filters.employeeIds) ||
			job.filters.employeeIds.includes(input.employeeId),
	);
	const jobIds = [
		...new Set([
			...affected.map((row) => row.jobId),
			...affectedJobs.map((job) => job.id),
		]),
	];
	if (jobIds.length)
		await tx
			.insert(payrollExportComparisonErasure)
			.values(
				jobIds.map((jobId) => ({
					jobId,
					organizationId: input.organizationId,
				})),
			)
			.onConflictDoNothing();
	if (jobIds.length)
		await tx
			.delete(payrollExportBaselineWindowInput)
			.where(
				and(
					eq(
						payrollExportBaselineWindowInput.organizationId,
						input.organizationId,
					),
					inArray(payrollExportBaselineWindowInput.jobId, jobIds),
				),
			);
	if (affected.length)
		await tx.delete(payrollComparisonResult).where(
			and(
				eq(payrollComparisonResult.organizationId, input.organizationId),
				inArray(
					payrollComparisonResult.baselineId,
					affected.map((row) => row.id),
				),
			),
		);
	const ids = affected.filter((row) => row.evidence).map((row) => row.id);
	if (!ids.length) return 0;
	const rows = await tx
		.update(payrollExportBaseline)
		.set({ evidence: null, unavailableReason: "erased" })
		.where(
			and(
				eq(payrollExportBaseline.organizationId, input.organizationId),
				inArray(payrollExportBaseline.id, ids),
				isNotNull(payrollExportBaseline.evidence),
			),
		)
		.returning({ id: payrollExportBaseline.id });
	return rows.length;
}
