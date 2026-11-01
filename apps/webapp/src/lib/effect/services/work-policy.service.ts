import { and, desc, eq, gt, gte, isNull, lte, or, type SQL } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import {
	employee,
	workPolicy,
	workPolicyAssignment,
	workPolicyPreset,
	workPolicyViolation,
} from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { type DatabaseError, NotFoundError } from "@/lib/effect/errors";
import { applicableBreakRule } from "@/lib/time-tracking/break-due";
import {
	loadEffectiveWorkPolicies,
	orderEffectiveAssignments,
	toEffectiveWorkPolicy,
	WORK_POLICY_DETAILS_WITH,
	type WorkPolicyWithDetails,
} from "@/lib/work-policy/effective-work-policies";
import { DatabaseService } from "./database.service";

// ============================================
// TYPES
// ============================================

export interface WorkPolicyScheduleDay {
	dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
	hoursPerDay: string;
	isWorkDay: boolean;
	/** Latest clock-in (`HH:mm`, local wall-clock) on detailed schedules; null when none. */
	latestClockIn: string | null;
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
	/** The policy the warnings come from; null when no regulated policy applied. */
	policyId: string | null;
}

export interface CheckComplianceInput {
	employeeId: string;
	/** Scopes the employee and every policy assignment lookup. */
	organizationId: string;
	/** The instant whose assignments apply: the checked work's end. */
	policyAt: Instant;
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
	/** When the violation happened, stored as `violation_date`: the checked work's start. */
	violationAt: Instant;
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

	const applicableRule = applicableBreakRule(regulation.breakRules, workedMinutes);

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

export class WorkPolicyService extends Context.Service<
	WorkPolicyService,
	{
		/**
		 * Get the effective work policy for an employee.
		 * Resolves hierarchical assignments: employee > team > organization.
		 */
		readonly getEffectivePolicy: (
			employeeId: string,
			organizationId?: string,
		) => Effect.Effect<EffectiveWorkPolicy | null, NotFoundError | DatabaseError>;

		/**
		 * The employee's work policy as of `at`, resolved like `getEffectivePolicy`
		 * and scoped to the organization. Past work is judged by the policy in force
		 * when it ended (ADR 0003), not by today's assignments.
		 */
		readonly getEffectivePolicyAt: (input: {
			employeeId: string;
			organizationId: string;
			at: Instant;
		}) => Effect.Effect<EffectiveWorkPolicy | null, NotFoundError | DatabaseError>;

		/**
		 * Many employees' work policies as of `at`, resolved like
		 * `getEffectivePolicyAt` in one organization-scoped query. The caller gives
		 * each employee's primary team. Keyed by employee id.
		 */
		readonly getEffectivePolicies: (input: {
			organizationId: string;
			employees: readonly { id: string; teamId: string | null }[];
			at: Instant;
		}) => Effect.Effect<Map<string, EffectiveWorkPolicy | null>, DatabaseError>;

		/**
		 * Check compliance for a working session against the policy in force at
		 * `policyAt`. The result names that policy. Fails when the employee is not
		 * in the organization.
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
>()("WorkPolicyService") {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const WorkPolicyServiceLive = Layer.effect(
	WorkPolicyService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;

		const findEmployeeForPolicy = (
			queryName: string,
			employeeId: string,
			organizationId: string | undefined,
		) =>
			dbService.query(queryName, async () => {
				return await dbService.db.query.employee.findFirst({
					where: organizationId
						? and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId))
						: eq(employee.id, employeeId),
					with: {
						team: true,
					},
				});
			});

		/**
		 * The first active assignment at one level that is in force at `at`. With
		 * `organizationId`, candidates are ordered deterministically and both the
		 * assignment and its policy must belong to that organization.
		 */
		const findLevelAssignment = (
			queryName: string,
			level: SQL | undefined,
			organizationId: string | undefined,
			at: Date,
		) =>
			dbService.query(queryName, async () => {
				const query = {
					where: and(
						level,
						organizationId ? eq(workPolicyAssignment.organizationId, organizationId) : undefined,
						eq(workPolicyAssignment.isActive, true),
						or(
							isNull(workPolicyAssignment.effectiveFrom),
							lte(workPolicyAssignment.effectiveFrom, at),
						),
						or(
							isNull(workPolicyAssignment.effectiveUntil),
							gt(workPolicyAssignment.effectiveUntil, at),
						),
					),
					with: {
						policy: {
							with: WORK_POLICY_DETAILS_WITH,
						},
					},
					orderBy: organizationId ? orderEffectiveAssignments : undefined,
				} as const;

				if (!organizationId) {
					return await dbService.db.query.workPolicyAssignment.findFirst(query);
				}

				const assignments = await dbService.db.query.workPolicyAssignment.findMany(query);
				return assignments.find(
					(assignment) =>
						assignment.policy?.isActive && assignment.policy.organizationId === organizationId,
				);
			});

		/**
		 * The employee's policy as of `at`: employee, then team, then organization
		 * assignment. With `organizationId`, every assignment and policy must belong
		 * to that organization.
		 */
		const resolveEffectivePolicy = (
			emp: {
				id: string;
				organizationId: string;
				teamId: string | null;
				team: { name: string } | null;
			},
			organizationId: string | undefined,
			at: Date,
		) =>
			Effect.gen(function* () {
				// 1. Check employee-level assignment (priority 2 - highest)
				const employeeAssignment = yield* findLevelAssignment(
					"getEmployeePolicyAssignment",
					and(
						eq(workPolicyAssignment.employeeId, emp.id),
						eq(workPolicyAssignment.assignmentType, "employee"),
					),
					organizationId,
					at,
				);
				if (employeeAssignment?.policy?.isActive) {
					return toEffectiveWorkPolicy(
						employeeAssignment.policy as WorkPolicyWithDetails,
						"employee",
						"Individual",
					);
				}

				// 2. Check team-level assignment (priority 1)
				if (emp.teamId) {
					const teamAssignment = yield* findLevelAssignment(
						"getTeamPolicyAssignment",
						and(
							eq(workPolicyAssignment.teamId, emp.teamId),
							eq(workPolicyAssignment.assignmentType, "team"),
						),
						organizationId,
						at,
					);
					if (teamAssignment?.policy?.isActive) {
						return toEffectiveWorkPolicy(
							teamAssignment.policy as WorkPolicyWithDetails,
							"team",
							emp.team?.name ?? "Team",
						);
					}
				}

				// 3. Check organization-level assignment (priority 0 - lowest)
				const orgAssignment = yield* findLevelAssignment(
					"getOrgPolicyAssignment",
					and(
						// A scoped lookup already filters by its organization.
						organizationId
							? undefined
							: eq(workPolicyAssignment.organizationId, emp.organizationId),
						eq(workPolicyAssignment.assignmentType, "organization"),
					),
					organizationId,
					at,
				);
				if (orgAssignment?.policy?.isActive) {
					return toEffectiveWorkPolicy(
						orgAssignment.policy as WorkPolicyWithDetails,
						"organization",
						"Organization Default",
					);
				}

				// No policy assigned
				return null;
			});

		/** The employee's policy as of `at`; fails when the employee is not found. */
		const effectivePolicyOf = (employeeId: string, organizationId: string | undefined, at: Date) =>
			Effect.gen(function* () {
				const emp = yield* findEmployeeForPolicy(
					"getEmployeeForPolicy",
					employeeId,
					organizationId,
				);
				if (!emp) {
					return yield* Effect.fail(
						new NotFoundError({
							message: "Employee not found",
							entityType: "employee",
							entityId: employeeId,
						}),
					);
				}
				return yield* resolveEffectivePolicy(emp, organizationId, at);
			});

		return WorkPolicyService.of({
			getEffectivePolicy: (employeeId, organizationId) =>
				effectivePolicyOf(employeeId, organizationId, new Date()),

			getEffectivePolicyAt: (input) =>
				effectivePolicyOf(input.employeeId, input.organizationId, dateFromInstant(input.at)),

			getEffectivePolicies: (input) =>
				dbService.query("workPolicy.effectivePolicies", () =>
					loadEffectiveWorkPolicies(dbService.db, input),
				),

			checkCompliance: (input) =>
				Effect.gen(function* () {
					// An employee outside the organization fails rather than passing unchecked.
					const policy = yield* effectivePolicyOf(
						input.employeeId,
						input.organizationId,
						dateFromInstant(input.policyAt),
					);

					if (!policy?.regulation) {
						return {
							isCompliant: true,
							warnings: [],
							breakRequirement: null,
							policyId: null,
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
						policyId: policy.policyId,
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
				Effect.gen(function* () {
					yield* dbService.query("logViolation", async () => {
						await dbService.db.insert(workPolicyViolation).values({
							employeeId: input.employeeId,
							organizationId: input.organizationId,
							policyId: input.policyId,
							workPeriodId: input.workPeriodId,
							violationDate: dateFromInstant(input.violationAt),
							violationType: input.violationType,
							details: input.details as typeof input.details & Record<string, unknown>,
						});
					});
				}),

			getViolations: (input) =>
				Effect.gen(function* () {
					const violations = yield* dbService.query("getViolations", async () => {
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
					});

					return violations as ViolationWithDetails[];
				}),

			getPresets: () =>
				Effect.gen(function* () {
					const presets = yield* dbService.query("getPresets", async () => {
						return await dbService.db.query.workPolicyPreset.findMany({
							where: eq(workPolicyPreset.isActive, true),
							orderBy: [desc(workPolicyPreset.name)],
						});
					});

					return presets;
				}),

			acknowledgeViolation: (params) =>
				Effect.gen(function* () {
					const violation = yield* dbService.query("getViolationForAck", async () => {
						return await dbService.db.query.workPolicyViolation.findFirst({
							where: eq(workPolicyViolation.id, params.violationId),
						});
					});

					if (!violation) {
						yield* Effect.fail(
							new NotFoundError({
								message: "Violation not found",
								entityType: "workPolicyViolation",
								entityId: params.violationId,
							}),
						);
						return;
					}

					yield* dbService.query("acknowledgeViolation", async () => {
						await dbService.db
							.update(workPolicyViolation)
							.set({
								acknowledgedBy: params.acknowledgedBy,
								acknowledgedAt: new Date(),
								acknowledgedNote: params.note,
							})
							.where(eq(workPolicyViolation.id, params.violationId));
					});
				}),

			getOrganizationPolicies: (organizationId) =>
				Effect.gen(function* () {
					const policies = yield* dbService.query("getOrgPolicies", async () => {
						return await dbService.db.query.workPolicy.findMany({
							where: and(
								eq(workPolicy.organizationId, organizationId),
								eq(workPolicy.isActive, true),
							),
							orderBy: (p, { asc }) => [asc(p.name)],
						});
					});

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
