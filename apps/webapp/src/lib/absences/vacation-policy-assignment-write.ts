import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db } from "@/db";
import { vacationAllowance, vacationPolicyAssignment, vacationPolicyRollout } from "@/db/schema";
import { type DatabaseError, ValidationError } from "@/lib/effect/errors";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";
export type VacationAssignmentDates = {
	effectiveFrom?: string;
	effectiveUntil?: string;
	reviewedBackdate?: boolean;
};
export class VacationPolicyConfigurationError extends Error {}
export async function loadVacationPolicyHistoryContext(
	database: AbsenceDaysDatabase,
	organizationId: string,
) {
	const timezone = await loadOrganizationTimezone(database, organizationId);
	const today = Temporal.Now.plainDateISO(timezone).toString();
	const rollout = await database.query.vacationPolicyRollout.findFirst({
		where: eq(vacationPolicyRollout.organizationId, organizationId),
	});
	return { timezone, today, baselineDate: rollout?.baselineDate ?? today };
}
function checkedDate(value: string) {
	try {
		const parsed = Temporal.PlainDate.from(value);
		if (parsed.toString() !== value) throw new Error();
		return value;
	} catch {
		throw new VacationPolicyConfigurationError("Use a valid calendar date (YYYY-MM-DD)");
	}
}
export async function writeVacationPolicyAssignment(
	database: typeof db,
	input: VacationAssignmentDates & {
		organizationId: string;
		createdBy: string;
		policyId: string | null;
		assignmentType: "organization" | "team" | "employee";
		teamId?: string;
		employeeId?: string;
	},
) {
	return database.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`vacation-policy:${input.organizationId}`},0))`,
		);
		const context = await loadVacationPolicyHistoryContext(tx, input.organizationId);
		const start = checkedDate(input.effectiveFrom ?? context.today);
		const end = input.effectiveUntil ? checkedDate(input.effectiveUntil) : null;
		if (start < "2026-01-01")
			throw new VacationPolicyConfigurationError(
				"Reviewed vacation history starts in 2026 or later",
			);
		if (start < context.today && !input.reviewedBackdate)
			throw new VacationPolicyConfigurationError("Backdating requires explicit admin review");
		if (end && end <= start)
			throw new VacationPolicyConfigurationError(
				"The assignment end must follow its start (end is exclusive)",
			);
		if (input.policyId) {
			const policy = await tx.query.vacationAllowance.findFirst({
				where: and(
					eq(vacationAllowance.organizationId, input.organizationId),
					eq(vacationAllowance.id, input.policyId),
				),
			});
			if (!policy?.isActive)
				throw new VacationPolicyConfigurationError("Choose an active policy in this organization");
		}
		const target = [
			eq(vacationPolicyAssignment.organizationId, input.organizationId),
			eq(vacationPolicyAssignment.assignmentType, input.assignmentType),
			eq(vacationPolicyAssignment.isActive, true),
		];
		if (input.employeeId) target.push(eq(vacationPolicyAssignment.employeeId, input.employeeId));
		if (input.teamId) target.push(eq(vacationPolicyAssignment.teamId, input.teamId));
		const rows = await tx
			.select()
			.from(vacationPolicyAssignment)
			.where(and(...target));
		const nextStart = rows
			.filter((row) => row.effectiveStartDate > start)
			.map((row) => row.effectiveStartDate)
			.toSorted()[0];
		const effectiveEnd =
			end && nextStart ? (end < nextStart ? end : nextStart) : (end ?? nextStart ?? null);
		const covering = rows.find(
			(row) =>
				row.effectiveStartDate <= start && (!row.effectiveEndDate || row.effectiveEndDate > start),
		);
		if (covering)
			await tx
				.update(vacationPolicyAssignment)
				.set({ effectiveEndDate: start })
				.where(
					and(
						eq(vacationPolicyAssignment.id, covering.id),
						eq(vacationPolicyAssignment.organizationId, input.organizationId),
					),
				);
		if (start < context.baselineDate && input.reviewedBackdate)
			await tx
				.update(vacationPolicyRollout)
				.set({
					reviewedFrom: sql`least(coalesce(${vacationPolicyRollout.reviewedFrom},${start}::date),${start}::date)`,
				})
				.where(eq(vacationPolicyRollout.organizationId, input.organizationId));
		if (!input.policyId) return null;
		const [assignment] = await tx
			.insert(vacationPolicyAssignment)
			.values({
				organizationId: input.organizationId,
				policyId: input.policyId,
				assignmentType: input.assignmentType,
				teamId: input.teamId ?? null,
				employeeId: input.employeeId ?? null,
				createdBy: input.createdBy,
				priority: input.assignmentType === "employee" ? 2 : input.assignmentType === "team" ? 1 : 0,
				effectiveStartDate: start,
				effectiveEndDate: effectiveEnd,
				reviewedBackdate: input.reviewedBackdate ?? false,
			})
			.returning();
		return assignment;
	});
}
export async function endVacationPolicyAssignment(
	database: typeof db,
	input: { organizationId: string; assignmentId: string; effectiveOn?: string },
) {
	return database.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`vacation-policy:${input.organizationId}`},0))`,
		);
		const { today } = await loadVacationPolicyHistoryContext(tx, input.organizationId);
		const date = checkedDate(input.effectiveOn ?? today);
		if (date < today)
			throw new VacationPolicyConfigurationError(
				"End an assignment today or on a future date; review historical corrections separately",
			);
		const row = await tx.query.vacationPolicyAssignment.findFirst({
			where: and(
				eq(vacationPolicyAssignment.organizationId, input.organizationId),
				eq(vacationPolicyAssignment.id, input.assignmentId),
			),
		});
		if (!row) throw new VacationPolicyConfigurationError("Vacation policy assignment not found");
		const requested = date < row.effectiveStartDate ? row.effectiveStartDate : date;
		const end =
			row.effectiveEndDate && row.effectiveEndDate < requested ? row.effectiveEndDate : requested;
		await tx
			.update(vacationPolicyAssignment)
			.set({ effectiveEndDate: end })
			.where(
				and(
					eq(vacationPolicyAssignment.id, row.id),
					eq(vacationPolicyAssignment.organizationId, input.organizationId),
				),
			);
	});
}

/** Only recognized configuration refusals cross the database boundary as user-facing copy. */
export function vacationPolicyWriteFailure(error: DatabaseError) {
	let cause: unknown = error.cause;
	while (cause && typeof cause === "object" && "cause" in cause && cause.cause) cause = cause.cause;
	if (cause instanceof VacationPolicyConfigurationError)
		return new ValidationError({
			message: cause.message,
			field: "effectiveFrom",
		});
	if (
		cause &&
		typeof cause === "object" &&
		"message" in cause &&
		typeof cause.message === "string" &&
		cause.message.startsWith("Vacation ")
	)
		return new ValidationError({
			message: cause.message,
			field: "effectiveFrom",
		});
	return error;
}
