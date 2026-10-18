import { z } from "zod";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { ReviewedPayrollComparison } from "./comparison-types";

const id = z.string().min(1);
const text = z.string().nullable();
const day = z.string().refine((value) => {
	try {
		parsePlainDate(value);
		return true;
	} catch {
		return false;
	}
});
const instant = z.string().refine((value) => {
	try {
		parseInstant(value);
		return true;
	} catch {
		return false;
	}
});
const filterBoundary = z.union([day, instant]);
const format = z.enum(["datev_lohn", "lexware_lohn", "sage_lohn"]);
const quantity = z.string().regex(/^-?\d+\.\d{2}$/);
const delta = z.string().regex(/^[+-]?\d+\.\d{2}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const status = z.enum(["added", "removed", "changed"]);
const contributionIdentity = {
	sourceId: id,
	sourceRevision: text,
	sourceActorId: text.optional(),
	employeeId: id,
	firstName: text,
	lastName: text,
	hours: z.number().finite(),
	reason: text,
};
const contribution = z.discriminatedUnion("kind", [
	z.object({
		...contributionIdentity,
		kind: z.literal("work"),
		facts: z.object({
			startAt: instant.nullable(),
			endAt: instant.nullable(),
			durationMinutes: z.number().finite(),
			workCategoryId: text,
			workCategoryName: text,
			projectId: text,
			projectName: text,
			mappingId: text,
		}),
	}),
	z.object({
		...contributionIdentity,
		kind: z.literal("absence"),
		facts: z.object({
			startDate: day,
			endDate: day,
			absenceCategoryId: id,
			absenceCategoryName: text,
			absenceType: text,
			status: z.string(),
			mappingId: id,
		}),
	}),
	z.object({
		...contributionIdentity,
		kind: z.literal("overtime_payout"),
		facts: z.object({ day, minutes: z.number().finite(), mappingId: text }),
	}),
]);
const outputRow = z.object({
	personnelNumber: z.string(),
	wageTypeCode: z.string(),
	date: day,
	quantity,
	unit: z.literal("hours"),
	note: z.string(),
	contributions: z.array(contribution).min(1),
});
const total = z.object({
	wageTypeCode: z.string(),
	unit: id,
	oldQuantity: quantity,
	newQuantity: quantity,
	delta,
	hasPayrollImpact: z.boolean(),
});
const rowChange = z
	.object({
		key: id,
		status,
		employeeIds: z.array(id),
		oldRow: outputRow.nullable(),
		newRow: outputRow.nullable(),
		delta,
		changedFields: z.array(id).min(1),
	})
	.refine((value) =>
		value.status === "added"
			? value.oldRow === null && value.newRow !== null
			: value.status === "removed"
				? value.oldRow !== null && value.newRow === null
				: value.oldRow !== null && value.newRow !== null,
	);
const employeeChange = z.object({
	employeeId: id,
	firstName: text,
	lastName: text,
	status: z.enum(["added", "removed", "changed", "source_only", "unchanged"]),
	oldPersonnelNumbers: z.array(z.string()),
	newPersonnelNumbers: z.array(z.string()),
	rowKeys: z.array(id),
	totals: z.array(total),
});
const sourceChange = z.object({
	key: id,
	employeeIds: z.array(id),
	oldRow: outputRow,
	newRow: outputRow,
	outputImpact: z.literal("none"),
});
const period = z
	.object({ startDate: day, endDate: day })
	.refine((value) => value.startDate <= value.endDate);
const reviewed = z
	.object({
		id,
		baseline: z.object({
			id,
			jobId: id,
			formatId: format,
			destination: z.object({
				configId: id,
				mandantennummer: id,
				beraternummer: id,
			}),
			period,
			employeeIds: z.array(id),
			createdAt: instant,
			completedAt: instant,
			expiresAt: instant,
			availability: z.enum([
				"available",
				"empty",
				"legacy",
				"expired",
				"erased",
				"corrupt",
				"unsupported_version",
			]),
		}),
		preparedAt: instant,
		expiresAt: instant,
		filters: z.object({
			dateRange: z.object({ start: filterBoundary, end: filterBoundary }),
			employeeIds: z.array(id).optional(),
			teamIds: z.array(id).optional(),
			projectIds: z.array(id).optional(),
		}),
		comparison: z.object({
			version: z.literal(1),
			formatId: format,
			formatterVersions: z.object({ old: id, new: id }),
			excludedLineKinds: z
				.array(id)
				.refine((value) => value.includes("expense")),
			hasPayrollImpact: z.boolean(),
			rows: z.array(rowChange),
			employees: z.array(employeeChange),
			totals: z.array(total),
			sourceOnlyChanges: z.array(sourceChange),
			summary: z.object({
				addedRows: count,
				removedRows: count,
				changedRows: count,
				addedEmployees: count,
				removedEmployees: count,
				changedEmployees: count,
				sourceOnlyEmployees: count,
			}),
		}),
		explanations: z
			.array(
				z.object({
					kind: z.enum(["work", "absence", "overtime_payout"]),
					sourceId: id,
					employeeId: id,
					action: id,
					actorId: text,
					reason: text,
				}),
			)
			.optional(),
	})
	.refine((value) => {
		const comparison = value.comparison;
		const scope = new Set(value.baseline.employeeIds);
		if (
			value.baseline.formatId !== comparison.formatId ||
			comparison.hasPayrollImpact !== comparison.rows.length > 0
		)
			return false;
		const rows = [...comparison.rows, ...comparison.sourceOnlyChanges];
		if (
			rows.some(
				(row) =>
					row.employeeIds.some((employeeId) => !scope.has(employeeId)) ||
					[row.oldRow, row.newRow].some((row) =>
						row?.contributions.some((source) => !scope.has(source.employeeId)),
					),
			)
		)
			return false;
		if (
			comparison.employees.some(
				(employee) => !scope.has(employee.employeeId),
			) ||
			value.explanations?.some(
				(explanation) => !scope.has(explanation.employeeId),
			)
		)
			return false;
		return (
			comparison.summary.addedRows ===
				comparison.rows.filter((row) => row.status === "added").length &&
			comparison.summary.removedRows ===
				comparison.rows.filter((row) => row.status === "removed").length &&
			comparison.summary.changedRows ===
				comparison.rows.filter((row) => row.status === "changed").length &&
			comparison.summary.addedEmployees ===
				comparison.employees.filter((employee) => employee.status === "added")
					.length &&
			comparison.summary.removedEmployees ===
				comparison.employees.filter((employee) => employee.status === "removed")
					.length &&
			comparison.summary.changedEmployees ===
				comparison.employees.filter((employee) => employee.status === "changed")
					.length &&
			comparison.summary.sourceOnlyEmployees ===
				comparison.employees.filter(
					(employee) => employee.status === "source_only",
				).length
		);
	});

/** A digest verifies retained bytes; this independently verifies every consumed value. */
export function isReviewedPayrollComparison(
	value: unknown,
): value is ReviewedPayrollComparison {
	try {
		return reviewed.safeParse(value).success;
	} catch {
		return false;
	}
}
