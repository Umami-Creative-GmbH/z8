import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { employee, workPolicyAssignment } from "@/db/schema";

export interface MobileEffectiveScheduleDay {
	dayOfWeek: string;
	hoursPerDay: string;
	isWorkDay: boolean;
	cycleWeek: number | null;
}

export interface MobileEffectiveSchedule {
	policyName: string;
	assignedVia: string;
	scheduleCycle: string;
	scheduleType: string;
	hoursPerCycle: string | null;
	homeOfficeDaysPerCycle: number | null;
	days: MobileEffectiveScheduleDay[];
}

type ScheduleAssignment = {
	policy?: {
		name: string;
		isActive: boolean;
		scheduleEnabled: boolean;
		schedule?: {
			scheduleCycle: string;
			scheduleType: string;
			hoursPerCycle: string | null;
			homeOfficeDaysPerCycle: number | null;
			days: MobileEffectiveScheduleDay[];
		} | null;
	} | null;
	team?: { name: string | null } | null;
};

function mapAssignment(
	assignment: ScheduleAssignment,
	assignedVia: string,
): MobileEffectiveSchedule | null {
	const policy = assignment.policy;
	const schedule = policy?.schedule;

	if (!policy?.isActive || !policy.scheduleEnabled || !schedule) {
		return null;
	}

	return {
		policyName: policy.name,
		assignedVia,
		scheduleCycle: schedule.scheduleCycle,
		scheduleType: schedule.scheduleType,
		hoursPerCycle: schedule.hoursPerCycle,
		homeOfficeDaysPerCycle: schedule.homeOfficeDaysPerCycle,
		days: schedule.days.map((day) => ({
			dayOfWeek: day.dayOfWeek,
			hoursPerDay: day.hoursPerDay,
			isWorkDay: day.isWorkDay,
			cycleWeek: day.cycleWeek,
		})),
	};
}

const scheduleAssignmentWith = {
	policy: {
		with: {
			schedule: {
				with: {
					days: true,
				},
			},
		},
	},
} as const;

export async function getMobileEffectiveSchedule(
	employeeId: string,
	organizationId: string,
): Promise<MobileEffectiveSchedule | null> {
	const emp = await db.query.employee.findFirst({
		where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
		columns: {
			id: true,
			teamId: true,
		},
	});

	if (!emp) {
		return null;
	}

	const employeeAssignment = await db.query.workPolicyAssignment.findFirst({
		where: and(
			eq(workPolicyAssignment.organizationId, organizationId),
			eq(workPolicyAssignment.employeeId, employeeId),
			eq(workPolicyAssignment.assignmentType, "employee"),
			eq(workPolicyAssignment.isActive, true),
			or(
				isNull(workPolicyAssignment.effectiveFrom),
				lte(workPolicyAssignment.effectiveFrom, sql`now()`),
			),
			or(
				isNull(workPolicyAssignment.effectiveUntil),
				gte(workPolicyAssignment.effectiveUntil, sql`now()`),
			),
		),
		orderBy: (assignment, { desc }) => [
			sql`${assignment.effectiveFrom} DESC NULLS LAST`,
			desc(assignment.createdAt),
		],
		with: scheduleAssignmentWith,
	});

	if (employeeAssignment) {
		const schedule = mapAssignment(employeeAssignment, "Individual");
		if (schedule) {
			return schedule;
		}
	}

	if (emp.teamId) {
		const teamAssignment = await db.query.workPolicyAssignment.findFirst({
			where: and(
				eq(workPolicyAssignment.organizationId, organizationId),
				eq(workPolicyAssignment.teamId, emp.teamId),
				eq(workPolicyAssignment.assignmentType, "team"),
				eq(workPolicyAssignment.isActive, true),
				or(
					isNull(workPolicyAssignment.effectiveFrom),
					lte(workPolicyAssignment.effectiveFrom, sql`now()`),
				),
				or(
					isNull(workPolicyAssignment.effectiveUntil),
					gte(workPolicyAssignment.effectiveUntil, sql`now()`),
				),
			),
			orderBy: (assignment, { desc }) => [
				sql`${assignment.effectiveFrom} DESC NULLS LAST`,
				desc(assignment.createdAt),
			],
			with: {
				...scheduleAssignmentWith,
				team: true,
			},
		});

		if (teamAssignment) {
			const schedule = mapAssignment(teamAssignment, teamAssignment.team?.name ?? "Team");
			if (schedule) {
				return schedule;
			}
		}
	}

	const organizationAssignment = await db.query.workPolicyAssignment.findFirst({
		where: and(
			eq(workPolicyAssignment.organizationId, organizationId),
			eq(workPolicyAssignment.assignmentType, "organization"),
			eq(workPolicyAssignment.isActive, true),
			or(
				isNull(workPolicyAssignment.effectiveFrom),
				lte(workPolicyAssignment.effectiveFrom, sql`now()`),
			),
			or(
				isNull(workPolicyAssignment.effectiveUntil),
				gte(workPolicyAssignment.effectiveUntil, sql`now()`),
			),
		),
		orderBy: (assignment, { desc }) => [
			sql`${assignment.effectiveFrom} DESC NULLS LAST`,
			desc(assignment.createdAt),
		],
		with: scheduleAssignmentWith,
	});

	if (!organizationAssignment) {
		return null;
	}

	return mapAssignment(organizationAssignment, "Organization Default");
}
