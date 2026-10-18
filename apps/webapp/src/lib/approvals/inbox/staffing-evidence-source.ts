import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import {
	absenceCategory,
	absenceEntry,
	coverageRule,
	employee,
	location,
	locationSubarea,
	shift,
} from "@/db/schema";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	shiftCalendarDate,
	shiftDateRangeBounds,
} from "@/lib/scheduling/shift-date";
import type { ApprovalDatabase } from "../server/types";
import type {
	CoverageAbsence,
	CoverageRule,
	CoverageShift,
} from "./absence-coverage";

interface StaffingEvidence {
	shifts: CoverageShift[];
	rules: CoverageRule[];
	absences: CoverageAbsence[];
}
/** Published staffing evidence whose employees, areas and parent locations belong to this organization. */
export async function readOrganizationStaffingEvidence(
	database: ApprovalDatabase,
	{
		organizationId,
		employeeId,
		startDate,
		endDate,
		timezone,
	}: {
		organizationId: string;
		employeeId: string;
		startDate: string;
		endDate: string;
		timezone: string;
	},
): Promise<StaffingEvidence> {
	const result: StaffingEvidence = { shifts: [], rules: [], absences: [] };
	const bounds = shiftDateRangeBounds(
		parsePlainDate(startDate).subtract({ days: 1 }),
		parsePlainDate(endDate).add({ days: 1 }),
		timezone,
	);
	const ownShifts = await database.query.shift.findMany({
		where: and(
			eq(shift.organizationId, organizationId),
			eq(shift.employeeId, employeeId),
			eq(shift.status, "published"),
			gte(shift.date, bounds.start),
			lt(shift.date, bounds.endExclusive),
		),
	});
	const subareas = [...new Set(ownShifts.map((own) => own.subareaId))];
	if (!subareas.length) return result;
	const allowedAreas = await database
		.select({ id: locationSubarea.id })
		.from(locationSubarea)
		.innerJoin(
			location,
			and(
				eq(location.id, locationSubarea.locationId),
				eq(location.organizationId, organizationId),
			),
		)
		.where(inArray(locationSubarea.id, subareas));
	if (allowedAreas.length !== subareas.length) return result;
	const [rules, published] = await Promise.all([
		database
			.select({
				id: coverageRule.id,
				organizationId: coverageRule.organizationId,
				subareaId: coverageRule.subareaId,
				dayOfWeek: coverageRule.dayOfWeek,
				startTime: coverageRule.startTime,
				endTime: coverageRule.endTime,
				minimumStaffCount: coverageRule.minimumStaffCount,
				subareaName: locationSubarea.name,
			})
			.from(coverageRule)
			.innerJoin(
				locationSubarea,
				eq(locationSubarea.id, coverageRule.subareaId),
			)
			.innerJoin(
				location,
				and(
					eq(location.id, locationSubarea.locationId),
					eq(location.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(coverageRule.organizationId, organizationId),
					inArray(coverageRule.subareaId, subareas),
				),
			),
		database
			.select({
				id: shift.id,
				organizationId: shift.organizationId,
				employeeId: shift.employeeId,
				subareaId: shift.subareaId,
				date: shift.date,
				startTime: shift.startTime,
				endTime: shift.endTime,
			})
			.from(shift)
			.innerJoin(locationSubarea, eq(locationSubarea.id, shift.subareaId))
			.innerJoin(
				location,
				and(
					eq(location.id, locationSubarea.locationId),
					eq(location.organizationId, organizationId),
				),
			)
			.innerJoin(
				employee,
				and(
					eq(employee.id, shift.employeeId),
					eq(employee.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(shift.organizationId, organizationId),
					eq(shift.status, "published"),
					inArray(shift.subareaId, subareas),
					gte(shift.date, bounds.start),
					lt(shift.date, bounds.endExclusive),
				),
			),
	]);
	result.shifts = published.map((own) => ({
		...own,
		date: shiftCalendarDate(own.date, timezone).toString(),
	}));
	result.rules = rules;
	const employeeIds = [
		...new Set(
			published.flatMap((own) => (own.employeeId ? [own.employeeId] : [])),
		),
	];
	if (employeeIds.length)
		result.absences = await database
			.select({
				id: absenceEntry.id,
				organizationId: absenceCategory.organizationId,
				employeeId: absenceEntry.employeeId,
				status: absenceEntry.status,
				startDate: absenceEntry.startDate,
				endDate: absenceEntry.endDate,
				startPeriod: absenceEntry.startPeriod,
				endPeriod: absenceEntry.endPeriod,
				requiresWorkTime: absenceCategory.requiresWorkTime,
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
					eq(absenceEntry.organizationId, organizationId),
					inArray(absenceEntry.employeeId, employeeIds),
					lte(absenceEntry.startDate, endDate),
					gte(absenceEntry.endDate, startDate),
				),
			);
	return result;
}
