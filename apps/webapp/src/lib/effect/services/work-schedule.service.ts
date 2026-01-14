import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { employee, workScheduleAssignment, workScheduleTemplate } from "@/db/schema";
import { type DatabaseError, NotFoundError } from "../errors";
import { DatabaseService } from "./database.service";

export interface WorkScheduleDay {
	dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
	hoursPerDay: string;
	isWorkDay: boolean;
}

export interface EffectiveWorkSchedule {
	templateId: string;
	templateName: string;
	scheduleCycle: "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
	scheduleType: "simple" | "detailed";
	workingDaysPreset: "weekdays" | "weekends" | "all_days" | "custom";
	hoursPerCycle: string | null;
	homeOfficeDaysPerCycle: number;
	days: WorkScheduleDay[];
	assignmentType: "organization" | "team" | "employee";
	assignedVia: string; // Organization name, team name, or "Individual"
}

export class WorkScheduleService extends Context.Tag("WorkScheduleService")<
	WorkScheduleService,
	{
		/**
		 * Get the effective work schedule for an employee
		 * Resolves based on priority: employee > team > organization
		 */
		readonly getEffectiveSchedule: (
			employeeId: string,
		) => Effect.Effect<EffectiveWorkSchedule | null, NotFoundError | DatabaseError>;

		/**
		 * Get all work schedule templates for an organization
		 */
		readonly getOrganizationTemplates: (organizationId: string) => Effect.Effect<
			Array<{
				id: string;
				name: string;
				scheduleCycle: string;
				scheduleType: string;
				hoursPerCycle: string | null;
				homeOfficeDaysPerCycle: number;
				isDefault: boolean;
			}>,
			DatabaseError
		>;

		/**
		 * Calculate total hours per week for a schedule
		 */
		readonly calculateWeeklyHours: (schedule: EffectiveWorkSchedule) => number;
	}
>() {}

export const WorkScheduleServiceLive = Layer.effect(
	WorkScheduleService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return WorkScheduleService.of({
			getEffectiveSchedule: (employeeId) =>
				Effect.gen(function* (_) {
					// Step 1: Get employee and verify they exist
					const emp = yield* _(
						dbService.query("getEmployeeById", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, employeeId),
							});
						}),
						Effect.flatMap((e) =>
							e
								? Effect.succeed(e)
								: Effect.fail(
										new NotFoundError({
											message: "Employee not found",
											entityType: "employee",
											entityId: employeeId,
										}),
									),
						),
					);

					if (!emp.organizationId) {
						return null; // Employee not associated with an organization
					}

					// Step 2: Check for employee-level assignment (highest priority)
					const employeeAssignment = yield* _(
						dbService.query("getEmployeeAssignment", async () => {
							return await dbService.db.query.workScheduleAssignment.findFirst({
								where: and(
									eq(workScheduleAssignment.employeeId, employeeId),
									eq(workScheduleAssignment.assignmentType, "employee"),
									eq(workScheduleAssignment.isActive, true),
								),
								with: {
									template: {
										with: {
											days: true,
										},
									},
								},
							});
						}),
					);

					if (employeeAssignment?.template) {
						return {
							templateId: employeeAssignment.template.id,
							templateName: employeeAssignment.template.name,
							scheduleCycle: employeeAssignment.template.scheduleCycle,
							scheduleType: employeeAssignment.template.scheduleType,
							workingDaysPreset: employeeAssignment.template.workingDaysPreset,
							hoursPerCycle: employeeAssignment.template.hoursPerCycle,
							homeOfficeDaysPerCycle: employeeAssignment.template.homeOfficeDaysPerCycle ?? 0,
							days: employeeAssignment.template.days.map((d) => ({
								dayOfWeek: d.dayOfWeek,
								hoursPerDay: d.hoursPerDay,
								isWorkDay: d.isWorkDay,
							})),
							assignmentType: "employee" as const,
							assignedVia: "Individual",
						};
					}

					// Step 3: Check for team-level assignment (if employee has a team)
					if (emp.teamId) {
						const teamAssignment = yield* _(
							dbService.query("getTeamAssignment", async () => {
								return await dbService.db.query.workScheduleAssignment.findFirst({
									where: and(
										eq(workScheduleAssignment.teamId, emp.teamId!),
										eq(workScheduleAssignment.assignmentType, "team"),
										eq(workScheduleAssignment.isActive, true),
									),
									with: {
										template: {
											with: {
												days: true,
											},
										},
										team: true,
									},
								});
							}),
						);

						if (teamAssignment?.template) {
							return {
								templateId: teamAssignment.template.id,
								templateName: teamAssignment.template.name,
								scheduleCycle: teamAssignment.template.scheduleCycle,
								scheduleType: teamAssignment.template.scheduleType,
								workingDaysPreset: teamAssignment.template.workingDaysPreset,
								hoursPerCycle: teamAssignment.template.hoursPerCycle,
								homeOfficeDaysPerCycle: teamAssignment.template.homeOfficeDaysPerCycle ?? 0,
								days: teamAssignment.template.days.map((d) => ({
									dayOfWeek: d.dayOfWeek,
									hoursPerDay: d.hoursPerDay,
									isWorkDay: d.isWorkDay,
								})),
								assignmentType: "team" as const,
								assignedVia: teamAssignment.team?.name || "Team",
							};
						}
					}

					// Step 4: Fall back to organization-level assignment
					const orgAssignment = yield* _(
						dbService.query("getOrgAssignment", async () => {
							return await dbService.db.query.workScheduleAssignment.findFirst({
								where: and(
									eq(workScheduleAssignment.organizationId, emp.organizationId!),
									eq(workScheduleAssignment.assignmentType, "organization"),
									eq(workScheduleAssignment.isActive, true),
								),
								with: {
									template: {
										with: {
											days: true,
										},
									},
								},
							});
						}),
					);

					if (orgAssignment?.template) {
						return {
							templateId: orgAssignment.template.id,
							templateName: orgAssignment.template.name,
							scheduleCycle: orgAssignment.template.scheduleCycle,
							scheduleType: orgAssignment.template.scheduleType,
							workingDaysPreset: orgAssignment.template.workingDaysPreset,
							hoursPerCycle: orgAssignment.template.hoursPerCycle,
							homeOfficeDaysPerCycle: orgAssignment.template.homeOfficeDaysPerCycle ?? 0,
							days: orgAssignment.template.days.map((d) => ({
								dayOfWeek: d.dayOfWeek,
								hoursPerDay: d.hoursPerDay,
								isWorkDay: d.isWorkDay,
							})),
							assignmentType: "organization" as const,
							assignedVia: "Organization Default",
						};
					}

					// No schedule assigned at any level
					return null;
				}),

			getOrganizationTemplates: (organizationId) =>
				Effect.gen(function* (_) {
					const templates = yield* _(
						dbService.query("getOrgTemplates", async () => {
							return await dbService.db.query.workScheduleTemplate.findMany({
								where: and(
									eq(workScheduleTemplate.organizationId, organizationId),
									eq(workScheduleTemplate.isActive, true),
								),
								orderBy: (t, { asc }) => [asc(t.name)],
							});
						}),
					);

					return templates.map((t) => ({
						id: t.id,
						name: t.name,
						scheduleCycle: t.scheduleCycle,
						scheduleType: t.scheduleType,
						hoursPerCycle: t.hoursPerCycle,
						homeOfficeDaysPerCycle: t.homeOfficeDaysPerCycle ?? 0,
						isDefault: t.isDefault,
					}));
				}),

			calculateWeeklyHours: (schedule) => {
				// For simple schedules, use hoursPerCycle divided by cycle length
				if (schedule.scheduleType === "simple" && schedule.hoursPerCycle) {
					const totalHours = parseFloat(schedule.hoursPerCycle);
					if (Number.isNaN(totalHours)) return 0;

					// Convert to weekly hours based on cycle
					switch (schedule.scheduleCycle) {
						case "daily":
							return totalHours * 7; // Assuming 7 days
						case "weekly":
							return totalHours;
						case "biweekly":
							return totalHours / 2;
						case "monthly":
							return (totalHours * 12) / 52; // Convert monthly to weekly
						case "yearly":
							return totalHours / 52;
						default:
							return totalHours;
					}
				}

				// For detailed schedules, sum up weekly hours
				if (schedule.days && schedule.days.length > 0) {
					return schedule.days
						.filter((d) => d.isWorkDay)
						.reduce((total, day) => {
							const hours = parseFloat(day.hoursPerDay);
							return total + (Number.isNaN(hours) ? 0 : hours);
						}, 0);
				}

				return 0;
			},
		});
	}),
);
