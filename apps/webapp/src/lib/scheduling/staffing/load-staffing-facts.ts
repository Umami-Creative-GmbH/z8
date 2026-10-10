import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeEmploymentHistory,
	employeeSkill,
	location,
	locationSubarea,
	shift,
	shiftRequest,
	shiftTemplate,
	shiftTemplateSkillRequirement,
	skill,
	subareaSkillRequirement,
	workPeriod,
	workPolicy,
	workPolicySchedule,
} from "@/db/schema";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant, type PlainDate } from "@/lib/datetime/temporal-core";
import type { EmploymentInterval } from "@/lib/employee-lifecycle/employment-coverage";
import { loadEmploymentCoverageByEmployee } from "@/lib/employee-lifecycle/employment-periods";
import type {
	ComplianceShiftSource,
	ComplianceWorkPeriodSource,
} from "@/lib/scheduling/compliance/employee-compliance-input";
import { shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import type { AbsenceRange } from "./staffing-blockers";
import { resolveSkillRequirements, type StaffingSkillRequirement } from "./staffing-skills";

type StaffingDatabase = Pick<typeof rootDatabase, "select">;

/** Days of completed work before the shift date that weekly, monthly and rest checks look back on. */
export const STAFFING_LOOKBACK_DAYS = 35;

export interface StaffingShiftContext {
	requirements: StaffingSkillRequirement[];
	/** Employees with a pending pickup request for the saved shift. */
	pickupRequesterIds: Set<string>;
}

/**
 * The open shift's skill requirements and pickup requesters, or null when the subarea is not
 * one of the organization's. A template or shift of another organization contributes nothing.
 */
export async function loadStaffingShiftContext(
	database: StaffingDatabase,
	input: {
		organizationId: string;
		subareaId: string;
		templateId: string | null;
		shiftId: string | null;
	},
): Promise<StaffingShiftContext | null> {
	const [subarea] = await database
		.select({ id: locationSubarea.id })
		.from(locationSubarea)
		.innerJoin(location, eq(locationSubarea.locationId, location.id))
		.where(
			and(
				eq(locationSubarea.id, input.subareaId),
				eq(location.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!subarea) return null;

	const [subareaRequirements, templateRequirements, pickupRequests] = await Promise.all([
		database
			.select({
				skillId: subareaSkillRequirement.skillId,
				skillName: skill.name,
				isRequired: subareaSkillRequirement.isRequired,
			})
			.from(subareaSkillRequirement)
			.innerJoin(skill, eq(subareaSkillRequirement.skillId, skill.id))
			.where(
				and(
					eq(subareaSkillRequirement.subareaId, input.subareaId),
					eq(skill.organizationId, input.organizationId),
				),
			)
			.orderBy(asc(skill.name)),
		input.templateId
			? database
					.select({
						skillId: shiftTemplateSkillRequirement.skillId,
						skillName: skill.name,
						isRequired: shiftTemplateSkillRequirement.isRequired,
					})
					.from(shiftTemplateSkillRequirement)
					.innerJoin(shiftTemplate, eq(shiftTemplateSkillRequirement.templateId, shiftTemplate.id))
					.innerJoin(skill, eq(shiftTemplateSkillRequirement.skillId, skill.id))
					.where(
						and(
							eq(shiftTemplateSkillRequirement.templateId, input.templateId),
							eq(shiftTemplate.organizationId, input.organizationId),
							eq(skill.organizationId, input.organizationId),
						),
					)
					.orderBy(asc(skill.name))
			: Promise.resolve([]),
		input.shiftId
			? database
					.select({ requesterId: shiftRequest.requesterId })
					.from(shiftRequest)
					.innerJoin(shift, eq(shiftRequest.shiftId, shift.id))
					.where(
						and(
							eq(shiftRequest.shiftId, input.shiftId),
							eq(shift.organizationId, input.organizationId),
							eq(shiftRequest.type, "pickup"),
							eq(shiftRequest.status, "pending"),
						),
					)
			: Promise.resolve([]),
	]);

	return {
		requirements: resolveSkillRequirements([...subareaRequirements, ...templateRequirements]),
		pickupRequesterIds: new Set(pickupRequests.map((request) => request.requesterId)),
	};
}

export interface StaffingAbsence extends AbsenceRange {
	categoryName: string;
}

export interface StaffingBlockerFacts {
	employmentCoverage: EmploymentInterval[] | null;
	approvedAbsences: StaffingAbsence[];
	pendingAbsences: StaffingAbsence[];
	/** Assigned shifts in any status from the day before the shift date to the day after. */
	nearbyShifts: ComplianceShiftSource[];
}

/**
 * What the staffing blockers and absence warnings need for every candidate, one query per kind.
 * Approved absences count only in categories that are not work time, as for daily work targets;
 * pending absences count in every category.
 */
export async function loadStaffingBlockerFacts(
	database: StaffingDatabase,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		timezone: string;
		shiftDate: PlainDate;
		excludeShiftId: string | null;
	},
): Promise<Map<string, StaffingBlockerFacts>> {
	const facts = new Map<string, StaffingBlockerFacts>();
	if (input.employeeIds.length === 0) return facts;
	const employeeIds = [...input.employeeIds];
	const nextDay = input.shiftDate.add({ days: 1 }).toString();
	const nearbyBounds = shiftDateRangeBounds(
		input.shiftDate.subtract({ days: 1 }),
		input.shiftDate.add({ days: 2 }),
		input.timezone,
	);

	const [members, coverage, absences, nearbyShifts] = await Promise.all([
		database
			.select({ id: employee.id })
			.from(employee)
			.where(
				and(eq(employee.organizationId, input.organizationId), inArray(employee.id, employeeIds)),
			),
		loadEmploymentCoverageByEmployee(database, {
			organizationId: input.organizationId,
			employeeIds,
		}),
		database
			.select({
				employeeId: absenceEntry.employeeId,
				status: absenceEntry.status,
				startDate: absenceEntry.startDate,
				startPeriod: absenceEntry.startPeriod,
				endDate: absenceEntry.endDate,
				endPeriod: absenceEntry.endPeriod,
				categoryName: absenceCategory.name,
			})
			.from(absenceEntry)
			.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
			.where(
				and(
					eq(absenceEntry.organizationId, input.organizationId),
					eq(absenceCategory.organizationId, input.organizationId),
					inArray(absenceEntry.employeeId, employeeIds),
					// Approved absences block only outside work time; any pending one is a warning.
					or(
						and(eq(absenceEntry.status, "approved"), eq(absenceCategory.requiresWorkTime, false)),
						eq(absenceEntry.status, "pending"),
					),
					lte(absenceEntry.startDate, nextDay),
					gte(absenceEntry.endDate, input.shiftDate.toString()),
				),
			),
		database
			.select({
				employeeId: shift.employeeId,
				date: shift.date,
				startTime: shift.startTime,
				endTime: shift.endTime,
			})
			.from(shift)
			.where(
				and(
					eq(shift.organizationId, input.organizationId),
					inArray(shift.employeeId, employeeIds),
					gte(shift.date, nearbyBounds.start),
					lt(shift.date, nearbyBounds.endExclusive),
					input.excludeShiftId ? ne(shift.id, input.excludeShiftId) : undefined,
				),
			),
	]);

	// Only the organization's own employees get facts, so no one else can be suggested.
	for (const { id: employeeId } of members) {
		facts.set(employeeId, {
			employmentCoverage: coverage.get(employeeId) ?? null,
			approvedAbsences: [],
			pendingAbsences: [],
			nearbyShifts: [],
		});
	}
	for (const absence of absences) {
		const target = facts.get(absence.employeeId);
		const range: StaffingAbsence = {
			startDate: absence.startDate,
			startPeriod: absence.startPeriod,
			endDate: absence.endDate,
			endPeriod: absence.endPeriod,
			categoryName: absence.categoryName,
		};
		if (absence.status === "approved") target?.approvedAbsences.push(range);
		else target?.pendingAbsences.push(range);
	}
	for (const nearby of nearbyShifts) {
		if (nearby.employeeId) facts.get(nearby.employeeId)?.nearbyShifts.push(nearby);
	}
	return facts;
}

export interface StaffingContractFacts {
	/** The confirmed employment terms in force on the shift date, else the employee's own. */
	contractType: "fixed" | "hourly";
	/** Set when those terms name a work policy: that policy's schedule cycle, null without one. */
	termsScheduleCycle: { cycle: string | null } | null;
}

export interface StaffingRankingFacts {
	/** Assigned shifts in any status from `shiftsFrom` on, the open shift itself left out. */
	shifts: ComplianceShiftSource[];
	workPeriods: ComplianceWorkPeriodSource[];
	heldSkills: Array<{ skillId: string; expiresAt: Date | null }>;
	contract: StaffingContractFacts;
}

/**
 * What ranking and compliance need for the candidates left after the blockers: their planned
 * shifts and completed work around the shift date, their skills, and their contract terms.
 */
export async function loadStaffingRankingFacts(
	database: StaffingDatabase,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		timezone: string;
		shiftDate: PlainDate;
		/** First organization-local day whose shifts count. */
		shiftsFrom: PlainDate;
		/** Day after the last one whose shifts and work count. */
		until: PlainDate;
		excludeShiftId: string | null;
	},
): Promise<Map<string, StaffingRankingFacts>> {
	const facts = new Map<string, StaffingRankingFacts>();
	if (input.employeeIds.length === 0) return facts;
	const employeeIds = [...input.employeeIds];
	const shiftBounds = shiftDateRangeBounds(input.shiftsFrom, input.until, input.timezone);
	const lookbackStart = dateFromInstant(
		localDayRange(
			input.shiftDate.subtract({ days: STAFFING_LOOKBACK_DAYS }).toString(),
			input.timezone,
		).start,
	);
	const shiftDayStart = dateFromInstant(
		localDayRange(input.shiftDate.toString(), input.timezone).start,
	);

	const [shifts, periods, skills, employees, terms] = await Promise.all([
		database
			.select({
				employeeId: shift.employeeId,
				date: shift.date,
				startTime: shift.startTime,
				endTime: shift.endTime,
			})
			.from(shift)
			.where(
				and(
					eq(shift.organizationId, input.organizationId),
					inArray(shift.employeeId, employeeIds),
					gte(shift.date, shiftBounds.start),
					lt(shift.date, shiftBounds.endExclusive),
					input.excludeShiftId ? ne(shift.id, input.excludeShiftId) : undefined,
				),
			),
		database
			.select({
				employeeId: workPeriod.employeeId,
				startTime: workPeriod.startTime,
				endTime: workPeriod.endTime,
				durationMinutes: workPeriod.durationMinutes,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, input.organizationId),
					inArray(workPeriod.employeeId, employeeIds),
					gte(workPeriod.startTime, lookbackStart),
					lt(workPeriod.startTime, shiftBounds.endExclusive),
					isNotNull(workPeriod.endTime),
				),
			),
		database
			.select({
				employeeId: employeeSkill.employeeId,
				skillId: employeeSkill.skillId,
				expiresAt: employeeSkill.expiresAt,
			})
			.from(employeeSkill)
			.innerJoin(skill, eq(employeeSkill.skillId, skill.id))
			.where(
				and(
					inArray(employeeSkill.employeeId, employeeIds),
					eq(skill.organizationId, input.organizationId),
				),
			),
		database
			.select({ id: employee.id, contractType: employee.contractType })
			.from(employee)
			.where(
				and(eq(employee.organizationId, input.organizationId), inArray(employee.id, employeeIds)),
			),
		database
			.select({
				employeeId: employeeEmploymentHistory.employeeId,
				validFrom: employeeEmploymentHistory.validFrom,
				contractType: employeeEmploymentHistory.contractType,
				workPolicyId: employeeEmploymentHistory.workPolicyId,
				policyActive: workPolicy.isActive,
				scheduleEnabled: workPolicy.scheduleEnabled,
				scheduleCycle: workPolicySchedule.scheduleCycle,
			})
			.from(employeeEmploymentHistory)
			.leftJoin(
				workPolicy,
				and(
					eq(employeeEmploymentHistory.workPolicyId, workPolicy.id),
					eq(workPolicy.organizationId, input.organizationId),
				),
			)
			.leftJoin(workPolicySchedule, eq(workPolicySchedule.policyId, workPolicy.id))
			.where(
				and(
					eq(employeeEmploymentHistory.organizationId, input.organizationId),
					inArray(employeeEmploymentHistory.employeeId, employeeIds),
					eq(employeeEmploymentHistory.reviewState, "confirmed"),
					lte(employeeEmploymentHistory.validFrom, shiftDayStart),
					or(
						isNull(employeeEmploymentHistory.validUntil),
						gt(employeeEmploymentHistory.validUntil, shiftDayStart),
					),
				),
			),
	]);

	const contractTypeByEmployee = new Map(employees.map((row) => [row.id, row.contractType]));
	for (const employeeId of employeeIds) {
		facts.set(employeeId, {
			shifts: [],
			workPeriods: [],
			heldSkills: [],
			contract: {
				contractType: contractTypeByEmployee.get(employeeId) ?? "fixed",
				termsScheduleCycle: null,
			},
		});
	}
	for (const row of shifts) {
		if (row.employeeId) facts.get(row.employeeId)?.shifts.push(row);
	}
	for (const row of periods) {
		facts.get(row.employeeId)?.workPeriods.push(row);
	}
	for (const row of skills) {
		facts.get(row.employeeId)?.heldSkills.push({ skillId: row.skillId, expiresAt: row.expiresAt });
	}
	// The latest confirmed terms in force on the shift date win.
	for (const row of terms.toSorted((a, b) => a.validFrom.getTime() - b.validFrom.getTime())) {
		const target = facts.get(row.employeeId);
		if (!target) continue;
		target.contract = {
			contractType: row.contractType,
			termsScheduleCycle: row.workPolicyId
				? {
						cycle: row.policyActive && row.scheduleEnabled ? (row.scheduleCycle ?? null) : null,
					}
				: null,
		};
	}
	return facts;
}
