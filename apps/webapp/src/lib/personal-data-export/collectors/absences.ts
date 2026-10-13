/**
 * Absences category of a personal data export (#811, #1168).
 *
 * The employee's absences with their sick detail, deputy and approval, the
 * vacation allowance overrides set for them, the vacation policies that reach
 * them (their own, their teams' and the organization default; names and rules
 * only), and every vacation adjustment with its reason. Nothing here is
 * withheld: the employee and admin exports hold the same rows.
 *
 * `absence_entry.organization_id` is nullable on legacy rows, so absences are
 * scoped through their organization's category and the org-checked employee;
 * `employee_vacation_allowance` and `vacation_adjustment` have no organization
 * and are scoped through the org-checked employee.
 */

import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import {
	absenceCategory,
	absenceEntry,
	employeeTeamHistory,
	employeeVacationAllowance,
	teamMembership,
	vacationAdjustment,
	vacationAllowance,
	vacationPolicyAssignment,
} from "@/db/schema";
import {
	type CollectedCategory,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	tablePart,
} from "../collector";
import { employeeNameLookup, instantText, loadSubjectEmployee } from "../values";
import { absencesFieldGuide } from "./absences-fields";

export const absencesCollector: PersonalDataCollector = {
	category: "absences",
	collect: collectAbsences,
	fields: absencesFieldGuide,
};

/** The subject's teams: primary, memberships and every team they were in. */
async function loadSubjectTeamIds(
	database: PersonalDataExportDatabase,
	{ organizationId, employeeId }: PersonalDataExportScope,
	primaryTeamId: string | null,
): Promise<string[]> {
	const [memberships, history] = await Promise.all([
		database
			.select({ teamId: teamMembership.teamId })
			.from(teamMembership)
			.where(
				and(
					eq(teamMembership.organizationId, organizationId),
					eq(teamMembership.employeeId, employeeId),
				),
			),
		database
			.select({ teamId: employeeTeamHistory.teamId })
			.from(employeeTeamHistory)
			.where(
				and(
					eq(employeeTeamHistory.organizationId, organizationId),
					eq(employeeTeamHistory.employeeId, employeeId),
				),
			),
	]);
	return [
		...new Set(
			[
				primaryTeamId,
				...memberships.map((row) => row.teamId),
				...history.map((row) => row.teamId),
			].filter((id): id is string => Boolean(id)),
		),
	];
}

async function collectAbsences(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<CollectedCategory> {
	const { organizationId, employeeId } = scope;
	const subject = await loadSubjectEmployee(database, scope);
	const teamIds = await loadSubjectTeamIds(database, scope, subject.teamId);

	const [absences, allowances, policies, adjustments] = await Promise.all([
		database
			.select({
				id: absenceEntry.id,
				category: absenceCategory.name,
				categoryType: absenceCategory.type,
				startDate: absenceEntry.startDate,
				startPeriod: absenceEntry.startPeriod,
				endDate: absenceEntry.endDate,
				endPeriod: absenceEntry.endPeriod,
				status: absenceEntry.status,
				sickDetail: absenceEntry.sickDetail,
				notes: absenceEntry.notes,
				deputyEmployeeId: absenceEntry.deputyEmployeeId,
				deputyAssignedAt: absenceEntry.deputyAssignedAt,
				approvedBy: absenceEntry.approvedBy,
				approvedAt: absenceEntry.approvedAt,
				rejectionReason: absenceEntry.rejectionReason,
				createdAt: absenceEntry.createdAt,
				updatedAt: absenceEntry.updatedAt,
			})
			.from(absenceEntry)
			.innerJoin(
				absenceCategory,
				and(
					eq(absenceCategory.id, absenceEntry.categoryId),
					eq(absenceCategory.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(absenceEntry.employeeId, employeeId),
					or(eq(absenceEntry.organizationId, organizationId), isNull(absenceEntry.organizationId)),
				),
			)
			.orderBy(asc(absenceEntry.startDate), asc(absenceEntry.createdAt)),
		database
			.select()
			.from(employeeVacationAllowance)
			.where(eq(employeeVacationAllowance.employeeId, employeeId))
			.orderBy(asc(employeeVacationAllowance.year)),
		database
			.select({
				policy: vacationAllowance,
				assignmentType: vacationPolicyAssignment.assignmentType,
				effectiveFrom: vacationPolicyAssignment.effectiveFrom,
				effectiveUntil: vacationPolicyAssignment.effectiveUntil,
				assignmentActive: vacationPolicyAssignment.isActive,
			})
			.from(vacationPolicyAssignment)
			.innerJoin(
				vacationAllowance,
				and(
					eq(vacationAllowance.id, vacationPolicyAssignment.policyId),
					eq(vacationAllowance.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(vacationPolicyAssignment.organizationId, organizationId),
					or(
						and(
							eq(vacationPolicyAssignment.assignmentType, "employee"),
							eq(vacationPolicyAssignment.employeeId, employeeId),
						),
						teamIds.length > 0
							? and(
									eq(vacationPolicyAssignment.assignmentType, "team"),
									inArray(vacationPolicyAssignment.teamId, teamIds),
								)
							: undefined,
						eq(vacationPolicyAssignment.assignmentType, "organization"),
					),
				),
			)
			.orderBy(asc(vacationPolicyAssignment.priority), asc(vacationAllowance.startDate)),
		database
			.select()
			.from(vacationAdjustment)
			.where(eq(vacationAdjustment.employeeId, employeeId))
			.orderBy(asc(vacationAdjustment.year), asc(vacationAdjustment.createdAt)),
	]);

	const byEmployee = await employeeNameLookup(database, organizationId, [
		...absences.flatMap((row) => [row.deputyEmployeeId, row.approvedBy]),
		...adjustments.map((row) => row.adjustedBy),
	]);

	return {
		category: "absences",
		parts: [
			tablePart(
				"absences",
				[
					"id",
					"category",
					"category_type",
					"start_date",
					"start_period",
					"end_date",
					"end_period",
					"status",
					"sick_detail",
					"notes",
					"deputy",
					"deputy_assigned_at",
					"approved_by",
					"approved_at",
					"rejection_reason",
					"created_at",
					"updated_at",
				],
				absences.map((row) => ({
					id: row.id,
					category: row.category,
					category_type: row.categoryType,
					start_date: row.startDate,
					start_period: row.startPeriod,
					end_date: row.endDate,
					end_period: row.endPeriod,
					status: row.status,
					sick_detail: row.sickDetail,
					notes: row.notes,
					// A deputy did not act on the absence: their display name only (#811 decision).
					deputy: byEmployee(row.deputyEmployeeId),
					deputy_assigned_at: instantText(row.deputyAssignedAt),
					approved_by: byEmployee(row.approvedBy),
					approved_at: instantText(row.approvedAt),
					rejection_reason: row.rejectionReason,
					created_at: instantText(row.createdAt),
					updated_at: instantText(row.updatedAt),
				})),
			),
			tablePart(
				"vacation_allowances",
				["year", "custom_annual_days", "custom_carryover_days", "created_at", "updated_at"],
				allowances.map((row) => ({
					year: row.year,
					custom_annual_days: row.customAnnualDays,
					custom_carryover_days: row.customCarryoverDays,
					created_at: instantText(row.createdAt),
					updated_at: instantText(row.updatedAt),
				})),
			),
			tablePart(
				"vacation_policies",
				[
					"policy",
					"assignment_type",
					"valid_from",
					"valid_until",
					"default_annual_days",
					"accrual_type",
					"accrual_start_month",
					"allow_carryover",
					"max_carryover_days",
					"carryover_expiry_months",
					"prorate_in_start_and_exit_year",
					"statutory_minimum_days",
					"assignment_effective_from",
					"assignment_effective_until",
					"assignment_active",
				],
				policies.map((row) => ({
					policy: row.policy.name,
					assignment_type: row.assignmentType,
					valid_from: row.policy.startDate,
					valid_until: row.policy.validUntil,
					default_annual_days: row.policy.defaultAnnualDays,
					accrual_type: row.policy.accrualType,
					accrual_start_month: row.policy.accrualStartMonth,
					allow_carryover: row.policy.allowCarryover,
					max_carryover_days: row.policy.maxCarryoverDays,
					carryover_expiry_months: row.policy.carryoverExpiryMonths,
					prorate_in_start_and_exit_year: row.policy.prorateInStartAndExitYear,
					statutory_minimum_days: row.policy.statutoryMinimumDays,
					assignment_effective_from: instantText(row.effectiveFrom),
					assignment_effective_until: instantText(row.effectiveUntil),
					assignment_active: row.assignmentActive,
				})),
			),
			tablePart(
				"vacation_adjustments",
				["year", "days", "kind", "accrual_month", "reason", "adjusted_by", "created_at"],
				adjustments.map((row) => ({
					year: row.year,
					days: row.days,
					kind: row.kind,
					accrual_month: row.accrualMonth,
					reason: row.reason,
					adjusted_by: byEmployee(row.adjustedBy),
					created_at: instantText(row.createdAt),
				})),
			),
		],
	};
}
