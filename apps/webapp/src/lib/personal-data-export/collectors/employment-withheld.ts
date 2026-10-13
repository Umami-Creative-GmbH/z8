/**
 * Withheld data of the Employment category (#811, #1166): billable and cost
 * rates, and departure tasks and reviews. They go into the admin export only;
 * the employee export never calls this. (Custom field values above employee
 * visibility are filtered by kind in the Employment collector itself.)
 *
 * Even here, technical columns stay out: a departure task's dedupe key, claim
 * token, attempts, last error and payload, and a review's internal metadata.
 */

import { and, asc, eq } from "drizzle-orm";
import {
	billableRate,
	costRate,
	employeeDepartureReview,
	employeeDepartureTask,
	project,
} from "@/db/schema";
import {
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	type PersonalDataPart,
	tablePart,
} from "../collector";
import { instantText, userNameLookup } from "../values";

export async function collectWithheldEmploymentParts(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<PersonalDataPart[]> {
	const { organizationId, employeeId } = scope;
	const [billableRates, costRates, tasks, reviews] = await Promise.all([
		database
			.select({
				level: billableRate.level,
				project: project.name,
				hourlyRate: billableRate.hourlyRate,
				effectiveFrom: billableRate.effectiveFrom,
				effectiveTo: billableRate.effectiveTo,
				createdAt: billableRate.createdAt,
				createdBy: billableRate.createdBy,
				updatedAt: billableRate.updatedAt,
				updatedBy: billableRate.updatedBy,
			})
			.from(billableRate)
			.leftJoin(
				project,
				and(eq(project.id, billableRate.projectId), eq(project.organizationId, organizationId)),
			)
			.where(
				and(
					eq(billableRate.organizationId, organizationId),
					eq(billableRate.employeeId, employeeId),
				),
			)
			.orderBy(asc(billableRate.level), asc(billableRate.effectiveFrom)),
		database
			.select()
			.from(costRate)
			.where(and(eq(costRate.organizationId, organizationId), eq(costRate.employeeId, employeeId)))
			.orderBy(asc(costRate.effectiveFrom)),
		database
			.select({
				id: employeeDepartureTask.id,
				departureId: employeeDepartureTask.departureId,
				kind: employeeDepartureTask.kind,
				status: employeeDepartureTask.status,
				completedAt: employeeDepartureTask.completedAt,
				createdAt: employeeDepartureTask.createdAt,
			})
			.from(employeeDepartureTask)
			.where(
				and(
					eq(employeeDepartureTask.organizationId, organizationId),
					eq(employeeDepartureTask.employeeId, employeeId),
				),
			)
			.orderBy(asc(employeeDepartureTask.createdAt)),
		database
			.select({
				id: employeeDepartureReview.id,
				departureId: employeeDepartureReview.departureId,
				kind: employeeDepartureReview.kind,
				subjectId: employeeDepartureReview.subjectId,
				status: employeeDepartureReview.status,
				resolution: employeeDepartureReview.resolution,
				resolvedAt: employeeDepartureReview.resolvedAt,
				resolvedBy: employeeDepartureReview.resolvedBy,
				affectedStartAt: employeeDepartureReview.affectedStartAt,
				affectedEndAt: employeeDepartureReview.affectedEndAt,
				createdAt: employeeDepartureReview.createdAt,
			})
			.from(employeeDepartureReview)
			.where(
				and(
					eq(employeeDepartureReview.organizationId, organizationId),
					eq(employeeDepartureReview.employeeId, employeeId),
				),
			)
			.orderBy(asc(employeeDepartureReview.createdAt)),
	]);

	const byUser = await userNameLookup(database, [
		...billableRates.flatMap((row) => [row.createdBy, row.updatedBy]),
		...costRates.flatMap((row) => [row.createdBy, row.updatedBy]),
		...reviews.map((row) => row.resolvedBy),
	]);
	const rateColumns = ["hourly_rate", "effective_from", "effective_to", "created_at", "created_by"];

	return [
		tablePart(
			"billable_rates",
			["level", "project", ...rateColumns, "updated_at", "updated_by"],
			billableRates.map((row) => ({
				level: row.level,
				project: row.project,
				hourly_rate: row.hourlyRate,
				effective_from: row.effectiveFrom,
				effective_to: row.effectiveTo,
				created_at: instantText(row.createdAt),
				created_by: byUser(row.createdBy),
				updated_at: instantText(row.updatedAt),
				updated_by: byUser(row.updatedBy),
			})),
		),
		tablePart(
			"cost_rates",
			[...rateColumns, "updated_at", "updated_by"],
			costRates.map((row) => ({
				hourly_rate: row.hourlyRate,
				effective_from: row.effectiveFrom,
				effective_to: row.effectiveTo,
				created_at: instantText(row.createdAt),
				created_by: byUser(row.createdBy),
				updated_at: instantText(row.updatedAt),
				updated_by: byUser(row.updatedBy),
			})),
		),
		tablePart(
			"departure_tasks",
			["id", "departure_id", "kind", "status", "completed_at", "created_at"],
			tasks.map((row) => ({
				id: row.id,
				departure_id: row.departureId,
				kind: row.kind,
				status: row.status,
				completed_at: instantText(row.completedAt),
				created_at: instantText(row.createdAt),
			})),
		),
		tablePart(
			"departure_reviews",
			[
				"id",
				"departure_id",
				"kind",
				"subject_id",
				"status",
				"affected_start_at",
				"affected_end_at",
				"resolution",
				"resolved_at",
				"resolved_by",
				"created_at",
			],
			reviews.map((row) => ({
				id: row.id,
				departure_id: row.departureId,
				kind: row.kind,
				subject_id: row.subjectId,
				status: row.status,
				affected_start_at: instantText(row.affectedStartAt),
				affected_end_at: instantText(row.affectedEndAt),
				resolution: row.resolution,
				resolved_at: instantText(row.resolvedAt),
				resolved_by: byUser(row.resolvedBy),
				created_at: instantText(row.createdAt),
			})),
		),
	];
}
