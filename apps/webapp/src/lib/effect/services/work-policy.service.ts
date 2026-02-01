import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import {
	employee,
	team,
	workPolicy,
	workPolicyAssignment,
	type workPolicyBreakOption,
	type workPolicyBreakRule,
	workPolicyPreset,
	type workPolicyRegulation,
	type workPolicySchedule,
	type workPolicyScheduleDay,
	workPolicyViolation,
	workPeriod,
} from "@/db/schema";
import { type DatabaseError, NotFoundError } from "../errors";
import { DatabaseService } from "./database.service";

// ============================================
// TYPES
// ============================================

export interface WorkPolicyScheduleDay {
	dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
	hoursPerDay: string;
	isWorkDay: boolean;
}

export interface BreakRuleOption {
	splitCount: number | null;
	minimumSplitMinutes: number | null;
	minimumLongestSplitMinutes: number | null;
}

export interface BreakRule {
	workingMinutesThreshold: number;
	requiredBreakMinutes: number;
	options: BreakRuleOption[];
}

export interface EffectiveWorkPolicy {
	policyId: string;
	policyName: string;

	// Schedule configuration (null if scheduleEnabled = false)
	schedule: {
		scheduleCycle: "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
		scheduleType: "simple" | "detailed";
		workingDaysPreset: "weekdays" | "weekends" | "all_days" | "custom";
		hoursPerCycle: string | null;
		homeOfficeDaysPerCycle: number;
		days: WorkPolicyScheduleDay[];
	} | null;

	// Regulation configuration (null if regulationEnabled = false)
	regulation: {
		maxDailyMinutes: number | null;
		maxWeeklyMinutes: number | null;
		maxUninterruptedMinutes: number | null;
		breakRules: BreakRule[];

		// ArbZG compliance fields
		minRestPeriodMinutes: number | null; // 11-hour rest period (660 min)
		restPeriodEnforcement: "block" | "warn" | "none"; // How to enforce rest period
		overtimeDailyThresholdMinutes: number | null; // Daily overtime threshold
		overtimeWeeklyThresholdMinutes: number | null; // Weekly overtime threshold
		overtimeMonthlyThresholdMinutes: number | null; // Monthly overtime threshold
		alertBeforeLimitMinutes: number; // Minutes before limit to show warning
		alertThresholdPercent: number; // Percentage of limit to show warning
	} | null;

	assignmentType: "organization" | "team" | "employee";
	assignedVia: string;
}

export interface ComplianceWarning {
	type: "max_daily" | "max_weekly" | "max_uninterrupted" | "break_required";
	message: string;
	actualValue: number;
	limitValue: number;
	severity: "warning" | "violation";
}

export interface BreakRequirementResult {
	isRequired: boolean;
	totalBreakNeeded: number;
	breakTaken: number;
	remaining: number;
	splitOptions: Array<{
		description: string;
		splitCount: number | null;
		minimumPerSplit: number | null;
	}>;
}

export interface ComplianceCheckResult {
	isCompliant: boolean;
	warnings: ComplianceWarning[];
	breakRequirement: BreakRequirementResult | null;
}

export interface CheckComplianceInput {
	employeeId: string;
	currentSessionMinutes: number;
	totalDailyMinutes: number;
	totalWeeklyMinutes: number;
	breaksTakenMinutes: number;
}

export interface LogViolationInput {
	employeeId: string;
	organizationId: string;
	policyId: string;
	workPeriodId?: string;
	violationType:
		| "max_daily"
		| "max_weekly"
		| "max_uninterrupted"
		| "break_required"
		| "rest_period"
		| "overtime_daily"
		| "overtime_weekly"
		| "overtime_monthly";
	details: {
		actualMinutes?: number;
		limitMinutes?: number;
		breakTakenMinutes?: number;
		breakRequiredMinutes?: number;
		uninterruptedMinutes?: number;
		warningShownAt?: string;
		userContinued?: boolean;
		// Rest period violation details
		lastClockOutTime?: string;
		attemptedClockInTime?: string;
		restPeriodMinutes?: number;
		requiredRestMinutes?: number;
		// Overtime violation details
		overtimeMinutes?: number;
		overtimeThreshold?: number;
		periodType?: "daily" | "weekly" | "monthly";
		// Exception handling
		exceptionId?: string;
		exceptionApprovedBy?: string;
	};
}

export interface GetViolationsInput {
	organizationId: string;
	startDate: Date;
	endDate: Date;
	employeeId?: string;
	violationType?: "max_daily" | "max_weekly" | "max_uninterrupted" | "break_required";
}

export type ViolationWithDetails = typeof workPolicyViolation.$inferSelect & {
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
	policy: {
		id: string;
		name: string;
	} | null;
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function formatMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (hours === 0) return `${mins}m`;
	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
}

function buildBreakOptionDescription(option: BreakRuleOption): string {
	if (
		option.splitCount === 1 ||
		(option.splitCount === null && !option.minimumLongestSplitMinutes)
	) {
		return "Take entire break at once";
	}
	if (option.splitCount === null && option.minimumLongestSplitMinutes) {
		return `Split into any number of breaks, with one lasting at least ${option.minimumLongestSplitMinutes} minutes`;
	}
	if (option.splitCount && option.minimumSplitMinutes) {
		return `Split into ${option.splitCount} breaks, each at least ${option.minimumSplitMinutes} minutes`;
	}
	return "Flexible break options";
}

function calculateBreakRequirementsInternal(params: {
	regulation: NonNullable<EffectiveWorkPolicy["regulation"]>;
	workedMinutes: number;
	breaksTakenMinutes: number;
}): BreakRequirementResult {
	const { regulation, workedMinutes, breaksTakenMinutes } = params;

	const applicableRule = regulation.breakRules
		.filter((rule) => workedMinutes > rule.workingMinutesThreshold)
		.sort((a, b) => b.workingMinutesThreshold - a.workingMinutesThreshold)[0];

	if (!applicableRule) {
		return {
			isRequired: false,
			totalBreakNeeded: 0,
			breakTaken: breaksTakenMinutes,
			remaining: 0,
			splitOptions: [],
		};
	}

	const remaining = Math.max(0, applicableRule.requiredBreakMinutes - breaksTakenMinutes);

	return {
		isRequired: true,
		totalBreakNeeded: applicableRule.requiredBreakMinutes,
		breakTaken: breaksTakenMinutes,
		remaining,
		splitOptions: applicableRule.options.map((opt) => ({
			description: buildBreakOptionDescription(opt),
			splitCount: opt.splitCount,
			minimumPerSplit: opt.minimumSplitMinutes,
		})),
	};
}

// ============================================
// SERVICE DEFINITION
// ============================================

export class WorkPolicyService extends Context.Tag("WorkPolicyService")<
	WorkPolicyService,
	{
		/**
		 * Get the effective work policy for an employee.
		 * Resolves hierarchical assignments: employee > team > organization.
		 */
		readonly getEffectivePolicy: (
			employeeId: string,
		) => Effect.Effect<EffectiveWorkPolicy | null, NotFoundError | DatabaseError>;

		/**
		 * Check compliance for a working session against the effective policy.
		 */
		readonly checkCompliance: (
			input: CheckComplianceInput,
		) => Effect.Effect<ComplianceCheckResult, NotFoundError | DatabaseError>;

		/**
		 * Calculate break requirements based on worked time.
		 */
		readonly calculateBreakRequirements: (params: {
			regulation: NonNullable<EffectiveWorkPolicy["regulation"]>;
			workedMinutes: number;
			breaksTakenMinutes: number;
		}) => BreakRequirementResult;

		/**
		 * Calculate total hours per week for a schedule.
		 */
		readonly calculateWeeklyHours: (
			schedule: NonNullable<EffectiveWorkPolicy["schedule"]>,
		) => number;

		/**
		 * Log a compliance violation to the database.
		 */
		readonly logViolation: (input: LogViolationInput) => Effect.Effect<void, DatabaseError>;

		/**
		 * Get violations for reporting with optional filters.
		 */
		readonly getViolations: (
			input: GetViolationsInput,
		) => Effect.Effect<ViolationWithDetails[], DatabaseError>;

		/**
		 * Get all available presets for import.
		 */
		readonly getPresets: () => Effect.Effect<
			(typeof workPolicyPreset.$inferSelect)[],
			DatabaseError
		>;

		/**
		 * Acknowledge a violation.
		 */
		readonly acknowledgeViolation: (params: {
			violationId: string;
			acknowledgedBy: string;
			note?: string;
		}) => Effect.Effect<void, NotFoundError | DatabaseError>;

		/**
		 * Get all work policies for an organization.
		 */
		readonly getOrganizationPolicies: (organizationId: string) => Effect.Effect<
			Array<{
				id: string;
				name: string;
				description: string | null;
				scheduleEnabled: boolean;
				regulationEnabled: boolean;
				isDefault: boolean;
				isActive: boolean;
			}>,
			DatabaseError
		>;
	}
>() {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const WorkPolicyServiceLive = Layer.effect(
	WorkPolicyService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		// Type definitions for the with clause results
		type PolicyWithDetails = typeof workPolicy.$inferSelect & {
			schedule:
				| (typeof workPolicySchedule.$inferSelect & {
						days: (typeof workPolicyScheduleDay.$inferSelect)[];
				  })
				| null;
			regulation:
				| (typeof workPolicyRegulation.$inferSelect & {
						breakRules: (typeof workPolicyBreakRule.$inferSelect & {
							options: (typeof workPolicyBreakOption.$inferSelect)[];
						})[];
				  })
				| null;
		};

		// Helper to map raw policy to EffectiveWorkPolicy
		const mapToEffective = (
			policy: PolicyWithDetails,
			assignmentType: "organization" | "team" | "employee",
			assignedVia: string,
		): EffectiveWorkPolicy => ({
			policyId: policy.id,
			policyName: policy.name,
			schedule:
				policy.scheduleEnabled && policy.schedule
					? {
							scheduleCycle: policy.schedule.scheduleCycle,
							scheduleType: policy.schedule.scheduleType,
							workingDaysPreset: policy.schedule.workingDaysPreset,
							hoursPerCycle: policy.schedule.hoursPerCycle,
							homeOfficeDaysPerCycle: policy.schedule.homeOfficeDaysPerCycle ?? 0,
							days: policy.schedule.days.map((d) => ({
								dayOfWeek: d.dayOfWeek,
								hoursPerDay: d.hoursPerDay,
								isWorkDay: d.isWorkDay,
							})),
						}
					: null,
			regulation:
				policy.regulationEnabled && policy.regulation
					? {
							maxDailyMinutes: policy.regulation.maxDailyMinutes,
							maxWeeklyMinutes: policy.regulation.maxWeeklyMinutes,
							maxUninterruptedMinutes: policy.regulation.maxUninterruptedMinutes,
							// ArbZG compliance fields
							minRestPeriodMinutes: policy.regulation.minRestPeriodMinutes,
							restPeriodEnforcement: policy.regulation.restPeriodEnforcement ?? "warn",
							overtimeDailyThresholdMinutes: policy.regulation.overtimeDailyThresholdMinutes,
							overtimeWeeklyThresholdMinutes: policy.regulation.overtimeWeeklyThresholdMinutes,
							overtimeMonthlyThresholdMinutes: policy.regulation.overtimeMonthlyThresholdMinutes,
							alertBeforeLimitMinutes: policy.regulation.alertBeforeLimitMinutes ?? 30,
							alertThresholdPercent: policy.regulation.alertThresholdPercent ?? 80,
							breakRules: policy.regulation.breakRules
								.sort((a, b) => a.sortOrder - b.sortOrder)
								.map((rule) => ({
									workingMinutesThreshold: rule.workingMinutesThreshold,
									requiredBreakMinutes: rule.requiredBreakMinutes,
									options: rule.options
										.sort((a, b) => a.sortOrder - b.sortOrder)
										.map((opt) => ({
											splitCount: opt.splitCount,
											minimumSplitMinutes: opt.minimumSplitMinutes,
											minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
										})),
								})),
						}
					: null,
			assignmentType,
			assignedVia,
		});

		return WorkPolicyService.of({
			getEffectivePolicy: (employeeId) =>
				Effect.gen(function* (_) {
					// 1. Get employee with team info
					const emp = yield* _(
						dbService.query("getEmployeeForPolicy", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, employeeId),
								with: {
									team: true,
								},
							});
						}),
					);

					if (!emp) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Employee not found",
									entityType: "employee",
									entityId: employeeId,
								}),
							),
						);
						return null;
					}

					const now = new Date();

					// Helper to build the with clause for policy relations
					const policyWith = {
						schedule: {
							with: { days: true },
						},
						regulation: {
							with: {
								breakRules: {
									with: { options: true },
								},
							},
						},
					} as const;

					// 2. Check employee-level assignment (priority 2 - highest)
					const employeeAssignment = yield* _(
						dbService.query("getEmployeePolicyAssignment", async () => {
							return await dbService.db.query.workPolicyAssignment.findFirst({
								where: and(
									eq(workPolicyAssignment.employeeId, employeeId),
									eq(workPolicyAssignment.assignmentType, "employee"),
									eq(workPolicyAssignment.isActive, true),
									or(
										isNull(workPolicyAssignment.effectiveFrom),
										lte(workPolicyAssignment.effectiveFrom, now),
									),
									or(
										isNull(workPolicyAssignment.effectiveUntil),
										gte(workPolicyAssignment.effectiveUntil, now),
									),
								),
								with: {
									policy: {
										with: policyWith,
									},
								},
							});
						}),
					);

					if (employeeAssignment?.policy?.isActive) {
						return mapToEffective(
							employeeAssignment.policy as PolicyWithDetails,
							"employee",
							"Individual",
						);
					}

					// 3. Check team-level assignment (priority 1)
					if (emp.teamId) {
						const teamAssignment = yield* _(
							dbService.query("getTeamPolicyAssignment", async () => {
								return await dbService.db.query.workPolicyAssignment.findFirst({
									where: and(
										eq(workPolicyAssignment.teamId, emp.teamId!),
										eq(workPolicyAssignment.assignmentType, "team"),
										eq(workPolicyAssignment.isActive, true),
										or(
											isNull(workPolicyAssignment.effectiveFrom),
											lte(workPolicyAssignment.effectiveFrom, now),
										),
										or(
											isNull(workPolicyAssignment.effectiveUntil),
											gte(workPolicyAssignment.effectiveUntil, now),
										),
									),
									with: {
										policy: {
											with: policyWith,
										},
										team: true,
									},
								});
							}),
						);

						if (teamAssignment?.policy?.isActive) {
							return mapToEffective(
								teamAssignment.policy as PolicyWithDetails,
								"team",
								teamAssignment.team?.name ?? "Team",
							);
						}
					}

					// 4. Check organization-level assignment (priority 0 - lowest)
					const orgAssignment = yield* _(
						dbService.query("getOrgPolicyAssignment", async () => {
							return await dbService.db.query.workPolicyAssignment.findFirst({
								where: and(
									eq(workPolicyAssignment.organizationId, emp.organizationId),
									eq(workPolicyAssignment.assignmentType, "organization"),
									eq(workPolicyAssignment.isActive, true),
									or(
										isNull(workPolicyAssignment.effectiveFrom),
										lte(workPolicyAssignment.effectiveFrom, now),
									),
									or(
										isNull(workPolicyAssignment.effectiveUntil),
										gte(workPolicyAssignment.effectiveUntil, now),
									),
								),
								with: {
									policy: {
										with: policyWith,
									},
								},
							});
						}),
					);

					if (orgAssignment?.policy?.isActive) {
						return mapToEffective(
							orgAssignment.policy as PolicyWithDetails,
							"organization",
							"Organization Default",
						);
					}

					// No policy assigned
					return null;
				}),

			checkCompliance: (input) =>
				Effect.gen(function* (_) {
					// Get employee with team info
					const emp = yield* _(
						dbService.query("getEmployeeForCompliance", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, input.employeeId),
								with: {
									team: true,
								},
							});
						}),
					);

					if (!emp) {
						return {
							isCompliant: true,
							warnings: [],
							breakRequirement: null,
						} as ComplianceCheckResult;
					}

					const now = new Date();

					// Helper to build the with clause for policy relations
					const policyWith = {
						schedule: {
							with: { days: true },
						},
						regulation: {
							with: {
								breakRules: {
									with: { options: true },
								},
							},
						},
					} as const;

					// Find effective policy (same logic as getEffectivePolicy)
					const findEffectivePolicy = async (): Promise<EffectiveWorkPolicy | null> => {
						// Check employee-level assignment (priority 2 - highest)
						const employeeAssignment = await dbService.db.query.workPolicyAssignment.findFirst({
							where: and(
								eq(workPolicyAssignment.employeeId, input.employeeId),
								eq(workPolicyAssignment.assignmentType, "employee"),
								eq(workPolicyAssignment.isActive, true),
								or(
									isNull(workPolicyAssignment.effectiveFrom),
									lte(workPolicyAssignment.effectiveFrom, now),
								),
								or(
									isNull(workPolicyAssignment.effectiveUntil),
									gte(workPolicyAssignment.effectiveUntil, now),
								),
							),
							with: {
								policy: {
									with: policyWith,
								},
							},
						});

						if (employeeAssignment?.policy?.isActive) {
							return mapToEffective(
								employeeAssignment.policy as PolicyWithDetails,
								"employee",
								"Individual",
							);
						}

						// Check team-level assignment (priority 1)
						if (emp.teamId) {
							const teamAssignment = await dbService.db.query.workPolicyAssignment.findFirst({
								where: and(
									eq(workPolicyAssignment.teamId, emp.teamId),
									eq(workPolicyAssignment.assignmentType, "team"),
									eq(workPolicyAssignment.isActive, true),
									or(
										isNull(workPolicyAssignment.effectiveFrom),
										lte(workPolicyAssignment.effectiveFrom, now),
									),
									or(
										isNull(workPolicyAssignment.effectiveUntil),
										gte(workPolicyAssignment.effectiveUntil, now),
									),
								),
								with: {
									policy: {
										with: policyWith,
									},
									team: true,
								},
							});

							if (teamAssignment?.policy?.isActive) {
								return mapToEffective(
									teamAssignment.policy as PolicyWithDetails,
									"team",
									teamAssignment.team?.name ?? "Team",
								);
							}
						}

						// Check organization-level assignment (priority 0 - lowest)
						const orgAssignment = await dbService.db.query.workPolicyAssignment.findFirst({
							where: and(
								eq(workPolicyAssignment.organizationId, emp.organizationId),
								eq(workPolicyAssignment.assignmentType, "organization"),
								eq(workPolicyAssignment.isActive, true),
								or(
									isNull(workPolicyAssignment.effectiveFrom),
									lte(workPolicyAssignment.effectiveFrom, now),
								),
								or(
									isNull(workPolicyAssignment.effectiveUntil),
									gte(workPolicyAssignment.effectiveUntil, now),
								),
							),
							with: {
								policy: {
									with: policyWith,
								},
							},
						});

						if (orgAssignment?.policy?.isActive) {
							return mapToEffective(
								orgAssignment.policy as PolicyWithDetails,
								"organization",
								"Organization Default",
							);
						}

						return null;
					};

					const policy = yield* _(Effect.promise(findEffectivePolicy));

					if (!policy || !policy.regulation) {
						return {
							isCompliant: true,
							warnings: [],
							breakRequirement: null,
						} as ComplianceCheckResult;
					}

					const { regulation } = policy;
					const warnings: ComplianceWarning[] = [];

					// Check max daily
					if (regulation.maxDailyMinutes && input.totalDailyMinutes > regulation.maxDailyMinutes) {
						warnings.push({
							type: "max_daily",
							message: `Daily working time (${formatMinutes(input.totalDailyMinutes)}) exceeds limit (${formatMinutes(regulation.maxDailyMinutes)})`,
							actualValue: input.totalDailyMinutes,
							limitValue: regulation.maxDailyMinutes,
							severity: "violation",
						});
					}

					// Check max weekly
					if (
						regulation.maxWeeklyMinutes &&
						input.totalWeeklyMinutes > regulation.maxWeeklyMinutes
					) {
						warnings.push({
							type: "max_weekly",
							message: `Weekly working time (${formatMinutes(input.totalWeeklyMinutes)}) exceeds limit (${formatMinutes(regulation.maxWeeklyMinutes)})`,
							actualValue: input.totalWeeklyMinutes,
							limitValue: regulation.maxWeeklyMinutes,
							severity: "violation",
						});
					}

					// Check max uninterrupted
					if (
						regulation.maxUninterruptedMinutes &&
						input.currentSessionMinutes > regulation.maxUninterruptedMinutes
					) {
						warnings.push({
							type: "max_uninterrupted",
							message: `Uninterrupted work (${formatMinutes(input.currentSessionMinutes)}) exceeds limit (${formatMinutes(regulation.maxUninterruptedMinutes)})`,
							actualValue: input.currentSessionMinutes,
							limitValue: regulation.maxUninterruptedMinutes,
							severity: "warning",
						});
					}

					// Calculate break requirements
					const breakReq = calculateBreakRequirementsInternal({
						regulation,
						workedMinutes: input.totalDailyMinutes,
						breaksTakenMinutes: input.breaksTakenMinutes,
					});

					if (breakReq.isRequired && breakReq.remaining > 0) {
						warnings.push({
							type: "break_required",
							message: `Break required: ${formatMinutes(breakReq.remaining)} remaining of ${formatMinutes(breakReq.totalBreakNeeded)} total`,
							actualValue: breakReq.breakTaken,
							limitValue: breakReq.totalBreakNeeded,
							severity: "warning",
						});
					}

					return {
						isCompliant: warnings.filter((w) => w.severity === "violation").length === 0,
						warnings,
						breakRequirement: breakReq,
					} as ComplianceCheckResult;
				}),

			calculateBreakRequirements: (params) => calculateBreakRequirementsInternal(params),

			calculateWeeklyHours: (schedule) => {
				// For simple schedules, use hoursPerCycle divided by cycle length
				if (schedule.scheduleType === "simple" && schedule.hoursPerCycle) {
					const totalHours = parseFloat(schedule.hoursPerCycle);
					if (Number.isNaN(totalHours)) return 0;

					// Convert to weekly hours based on cycle
					switch (schedule.scheduleCycle) {
						case "daily":
							return totalHours * 7;
						case "weekly":
							return totalHours;
						case "biweekly":
							return totalHours / 2;
						case "monthly":
							return (totalHours * 12) / 52;
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

			logViolation: (input) =>
				Effect.gen(function* (_) {
					yield* _(
						dbService.query("logViolation", async () => {
							await dbService.db.insert(workPolicyViolation).values({
								employeeId: input.employeeId,
								organizationId: input.organizationId,
								policyId: input.policyId,
								workPeriodId: input.workPeriodId,
								violationDate: new Date(),
								violationType: input.violationType,
								details: input.details as typeof input.details & Record<string, unknown>,
							});
						}),
					);
				}),

			getViolations: (input) =>
				Effect.gen(function* (_) {
					const violations = yield* _(
						dbService.query("getViolations", async () => {
							const conditions = [
								eq(workPolicyViolation.organizationId, input.organizationId),
								gte(workPolicyViolation.violationDate, input.startDate),
								lte(workPolicyViolation.violationDate, input.endDate),
							];

							if (input.employeeId) {
								conditions.push(eq(workPolicyViolation.employeeId, input.employeeId));
							}

							if (input.violationType) {
								conditions.push(eq(workPolicyViolation.violationType, input.violationType));
							}

							return await dbService.db.query.workPolicyViolation.findMany({
								where: and(...conditions),
								with: {
									employee: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
										},
									},
									policy: {
										columns: {
											id: true,
											name: true,
										},
									},
								},
								orderBy: [desc(workPolicyViolation.violationDate)],
							});
						}),
					);

					return violations as ViolationWithDetails[];
				}),

			getPresets: () =>
				Effect.gen(function* (_) {
					const presets = yield* _(
						dbService.query("getPresets", async () => {
							return await dbService.db.query.workPolicyPreset.findMany({
								where: eq(workPolicyPreset.isActive, true),
								orderBy: [desc(workPolicyPreset.name)],
							});
						}),
					);

					return presets;
				}),

			acknowledgeViolation: (params) =>
				Effect.gen(function* (_) {
					const violation = yield* _(
						dbService.query("getViolationForAck", async () => {
							return await dbService.db.query.workPolicyViolation.findFirst({
								where: eq(workPolicyViolation.id, params.violationId),
							});
						}),
					);

					if (!violation) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Violation not found",
									entityType: "workPolicyViolation",
									entityId: params.violationId,
								}),
							),
						);
						return;
					}

					yield* _(
						dbService.query("acknowledgeViolation", async () => {
							await dbService.db
								.update(workPolicyViolation)
								.set({
									acknowledgedBy: params.acknowledgedBy,
									acknowledgedAt: new Date(),
									acknowledgedNote: params.note,
								})
								.where(eq(workPolicyViolation.id, params.violationId));
						}),
					);
				}),

			getOrganizationPolicies: (organizationId) =>
				Effect.gen(function* (_) {
					const policies = yield* _(
						dbService.query("getOrgPolicies", async () => {
							return await dbService.db.query.workPolicy.findMany({
								where: and(
									eq(workPolicy.organizationId, organizationId),
									eq(workPolicy.isActive, true),
								),
								orderBy: (p, { asc }) => [asc(p.name)],
							});
						}),
					);

					return policies.map((p) => ({
						id: p.id,
						name: p.name,
						description: p.description,
						scheduleEnabled: p.scheduleEnabled,
						regulationEnabled: p.regulationEnabled,
						isDefault: p.isDefault,
						isActive: p.isActive,
					}));
				}),
		});
	}),
);
