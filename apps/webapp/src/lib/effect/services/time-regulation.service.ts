import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import {
	employee,
	team,
	type timeRegulation,
	timeRegulationAssignment,
	type timeRegulationBreakOption,
	type timeRegulationBreakRule,
	timeRegulationPreset,
	timeRegulationViolation,
	workPeriod,
} from "@/db/schema";
import type {
	BreakRequirementResult,
	ComplianceCheckResult,
	ComplianceWarning,
	EffectiveTimeRegulation,
} from "@/lib/time-regulations/validation";
import { type DatabaseError, NotFoundError } from "../errors";
import { DatabaseService } from "./database.service";

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

function buildBreakOptionDescription(option: {
	splitCount: number | null;
	minimumSplitMinutes: number | null;
	minimumLongestSplitMinutes: number | null;
}): string {
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

/**
 * Internal pure function for calculating break requirements.
 * Used by both the service method and checkCompliance to avoid circular calls.
 */
function calculateBreakRequirementsInternal(params: {
	regulation: EffectiveTimeRegulation;
	workedMinutes: number;
	breaksTakenMinutes: number;
}): BreakRequirementResult {
	const { regulation, workedMinutes, breaksTakenMinutes } = params;

	// Find the applicable break rule (highest threshold that applies)
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
// SERVICE INTERFACE
// ============================================

export interface GetViolationsInput {
	organizationId: string;
	startDate: Date;
	endDate: Date;
	employeeId?: string;
	violationType?: "max_daily" | "max_weekly" | "max_uninterrupted" | "break_required";
}

export interface LogViolationInput {
	employeeId: string;
	organizationId: string;
	regulationId: string;
	workPeriodId?: string;
	violationType: "max_daily" | "max_weekly" | "max_uninterrupted" | "break_required";
	details: {
		actualMinutes?: number;
		limitMinutes?: number;
		breakTakenMinutes?: number;
		breakRequiredMinutes?: number;
		uninterruptedMinutes?: number;
		warningShownAt?: string;
		userContinued?: boolean;
	};
}

export interface CheckComplianceInput {
	employeeId: string;
	currentSessionMinutes: number;
	totalDailyMinutes: number;
	totalWeeklyMinutes: number;
	breaksTakenMinutes: number;
}

export type ViolationWithDetails = typeof timeRegulationViolation.$inferSelect & {
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
	regulation: {
		id: string;
		name: string;
	} | null;
};

export class TimeRegulationService extends Context.Tag("TimeRegulationService")<
	TimeRegulationService,
	{
		/**
		 * Get the effective time regulation for an employee.
		 * Resolves hierarchical assignments: employee > team > organization.
		 */
		readonly getEffectiveRegulation: (
			employeeId: string,
		) => Effect.Effect<EffectiveTimeRegulation | null, NotFoundError | DatabaseError>;

		/**
		 * Check compliance for a working session against the effective regulation.
		 */
		readonly checkCompliance: (
			input: CheckComplianceInput,
		) => Effect.Effect<ComplianceCheckResult, NotFoundError | DatabaseError>;

		/**
		 * Calculate break requirements based on worked time.
		 */
		readonly calculateBreakRequirements: (params: {
			regulation: EffectiveTimeRegulation;
			workedMinutes: number;
			breaksTakenMinutes: number;
		}) => BreakRequirementResult;

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
			(typeof timeRegulationPreset.$inferSelect)[],
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
	}
>() {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const TimeRegulationServiceLive = Layer.effect(
	TimeRegulationService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		// Helper to map raw assignment + regulation to EffectiveTimeRegulation
		const mapToEffective = (
			regulation: typeof timeRegulation.$inferSelect & {
				breakRules: (typeof timeRegulationBreakRule.$inferSelect & {
					options: (typeof timeRegulationBreakOption.$inferSelect)[];
				})[];
			},
			assignmentType: "organization" | "team" | "employee",
			assignedVia: string,
		): EffectiveTimeRegulation => ({
			regulationId: regulation.id,
			regulationName: regulation.name,
			maxDailyMinutes: regulation.maxDailyMinutes,
			maxWeeklyMinutes: regulation.maxWeeklyMinutes,
			maxUninterruptedMinutes: regulation.maxUninterruptedMinutes,
			breakRules: regulation.breakRules
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
			assignmentType,
			assignedVia,
		});

		return TimeRegulationService.of({
			getEffectiveRegulation: (employeeId) =>
				Effect.gen(function* (_) {
					// 1. Get employee with team info
					const emp = yield* _(
						dbService.query("getEmployeeForRegulation", async () => {
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
						return null; // TypeScript needs this after fail
					}

					const now = new Date();

					// 2. Check employee-level assignment (priority 2 - highest)
					const employeeAssignment = yield* _(
						dbService.query("getEmployeeRegulationAssignment", async () => {
							return await dbService.db.query.timeRegulationAssignment.findFirst({
								where: and(
									eq(timeRegulationAssignment.employeeId, employeeId),
									eq(timeRegulationAssignment.assignmentType, "employee"),
									eq(timeRegulationAssignment.isActive, true),
									or(
										isNull(timeRegulationAssignment.effectiveFrom),
										lte(timeRegulationAssignment.effectiveFrom, now),
									),
									or(
										isNull(timeRegulationAssignment.effectiveUntil),
										gte(timeRegulationAssignment.effectiveUntil, now),
									),
								),
								with: {
									regulation: {
										with: {
											breakRules: {
												with: { options: true },
											},
										},
									},
								},
							});
						}),
					);

					if (employeeAssignment?.regulation?.isActive) {
						return mapToEffective(employeeAssignment.regulation, "employee", "Individual");
					}

					// 3. Check team-level assignment (priority 1)
					if (emp.teamId) {
						const teamAssignment = yield* _(
							dbService.query("getTeamRegulationAssignment", async () => {
								return await dbService.db.query.timeRegulationAssignment.findFirst({
									where: and(
										eq(timeRegulationAssignment.teamId, emp.teamId!),
										eq(timeRegulationAssignment.assignmentType, "team"),
										eq(timeRegulationAssignment.isActive, true),
										or(
											isNull(timeRegulationAssignment.effectiveFrom),
											lte(timeRegulationAssignment.effectiveFrom, now),
										),
										or(
											isNull(timeRegulationAssignment.effectiveUntil),
											gte(timeRegulationAssignment.effectiveUntil, now),
										),
									),
									with: {
										regulation: {
											with: {
												breakRules: {
													with: { options: true },
												},
											},
										},
										team: true,
									},
								});
							}),
						);

						if (teamAssignment?.regulation?.isActive) {
							return mapToEffective(
								teamAssignment.regulation,
								"team",
								teamAssignment.team?.name ?? "Team",
							);
						}
					}

					// 4. Check organization-level assignment (priority 0 - lowest)
					const orgAssignment = yield* _(
						dbService.query("getOrgRegulationAssignment", async () => {
							return await dbService.db.query.timeRegulationAssignment.findFirst({
								where: and(
									eq(timeRegulationAssignment.organizationId, emp.organizationId),
									eq(timeRegulationAssignment.assignmentType, "organization"),
									eq(timeRegulationAssignment.isActive, true),
									or(
										isNull(timeRegulationAssignment.effectiveFrom),
										lte(timeRegulationAssignment.effectiveFrom, now),
									),
									or(
										isNull(timeRegulationAssignment.effectiveUntil),
										gte(timeRegulationAssignment.effectiveUntil, now),
									),
								),
								with: {
									regulation: {
										with: {
											breakRules: {
												with: { options: true },
											},
										},
									},
								},
							});
						}),
					);

					if (orgAssignment?.regulation?.isActive) {
						return mapToEffective(orgAssignment.regulation, "organization", "Organization Default");
					}

					// No regulation assigned
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

					// Helper to find effective regulation
					const findEffectiveRegulation = async (): Promise<EffectiveTimeRegulation | null> => {
						// Check employee-level assignment (priority 2 - highest)
						const employeeAssignment = await dbService.db.query.timeRegulationAssignment.findFirst({
							where: and(
								eq(timeRegulationAssignment.employeeId, input.employeeId),
								eq(timeRegulationAssignment.assignmentType, "employee"),
								eq(timeRegulationAssignment.isActive, true),
								or(
									isNull(timeRegulationAssignment.effectiveFrom),
									lte(timeRegulationAssignment.effectiveFrom, now),
								),
								or(
									isNull(timeRegulationAssignment.effectiveUntil),
									gte(timeRegulationAssignment.effectiveUntil, now),
								),
							),
							with: {
								regulation: {
									with: {
										breakRules: {
											with: { options: true },
										},
									},
								},
							},
						});

						if (employeeAssignment?.regulation?.isActive) {
							return mapToEffective(employeeAssignment.regulation, "employee", "Individual");
						}

						// Check team-level assignment (priority 1)
						if (emp.teamId) {
							const teamAssignment = await dbService.db.query.timeRegulationAssignment.findFirst({
								where: and(
									eq(timeRegulationAssignment.teamId, emp.teamId),
									eq(timeRegulationAssignment.assignmentType, "team"),
									eq(timeRegulationAssignment.isActive, true),
									or(
										isNull(timeRegulationAssignment.effectiveFrom),
										lte(timeRegulationAssignment.effectiveFrom, now),
									),
									or(
										isNull(timeRegulationAssignment.effectiveUntil),
										gte(timeRegulationAssignment.effectiveUntil, now),
									),
								),
								with: {
									regulation: {
										with: {
											breakRules: {
												with: { options: true },
											},
										},
									},
									team: true,
								},
							});

							if (teamAssignment?.regulation?.isActive) {
								return mapToEffective(
									teamAssignment.regulation,
									"team",
									teamAssignment.team?.name ?? "Team",
								);
							}
						}

						// Check organization-level assignment (priority 0 - lowest)
						const orgAssignment = await dbService.db.query.timeRegulationAssignment.findFirst({
							where: and(
								eq(timeRegulationAssignment.organizationId, emp.organizationId),
								eq(timeRegulationAssignment.assignmentType, "organization"),
								eq(timeRegulationAssignment.isActive, true),
								or(
									isNull(timeRegulationAssignment.effectiveFrom),
									lte(timeRegulationAssignment.effectiveFrom, now),
								),
								or(
									isNull(timeRegulationAssignment.effectiveUntil),
									gte(timeRegulationAssignment.effectiveUntil, now),
								),
							),
							with: {
								regulation: {
									with: {
										breakRules: {
											with: { options: true },
										},
									},
								},
							},
						});

						if (orgAssignment?.regulation?.isActive) {
							return mapToEffective(
								orgAssignment.regulation,
								"organization",
								"Organization Default",
							);
						}

						return null;
					};

					const regulation = yield* _(Effect.promise(findEffectiveRegulation));

					if (!regulation) {
						return {
							isCompliant: true,
							warnings: [],
							breakRequirement: null,
						} as ComplianceCheckResult;
					}

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

					// Calculate break requirements directly (it's a pure function)
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

			logViolation: (input) =>
				Effect.gen(function* (_) {
					yield* _(
						dbService.query("logViolation", async () => {
							await dbService.db.insert(timeRegulationViolation).values({
								employeeId: input.employeeId,
								organizationId: input.organizationId,
								regulationId: input.regulationId,
								workPeriodId: input.workPeriodId,
								violationDate: new Date(),
								violationType: input.violationType,
								// The text column with $type expects the object, Drizzle will serialize it
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
								eq(timeRegulationViolation.organizationId, input.organizationId),
								gte(timeRegulationViolation.violationDate, input.startDate),
								lte(timeRegulationViolation.violationDate, input.endDate),
							];

							if (input.employeeId) {
								conditions.push(eq(timeRegulationViolation.employeeId, input.employeeId));
							}

							if (input.violationType) {
								conditions.push(eq(timeRegulationViolation.violationType, input.violationType));
							}

							return await dbService.db.query.timeRegulationViolation.findMany({
								where: and(...conditions),
								with: {
									employee: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
										},
									},
									regulation: {
										columns: {
											id: true,
											name: true,
										},
									},
								},
								orderBy: [desc(timeRegulationViolation.violationDate)],
							});
						}),
					);

					return violations as ViolationWithDetails[];
				}),

			getPresets: () =>
				Effect.gen(function* (_) {
					const presets = yield* _(
						dbService.query("getPresets", async () => {
							return await dbService.db.query.timeRegulationPreset.findMany({
								where: eq(timeRegulationPreset.isActive, true),
								orderBy: [desc(timeRegulationPreset.name)],
							});
						}),
					);

					return presets;
				}),

			acknowledgeViolation: (params) =>
				Effect.gen(function* (_) {
					const violation = yield* _(
						dbService.query("getViolationForAck", async () => {
							return await dbService.db.query.timeRegulationViolation.findFirst({
								where: eq(timeRegulationViolation.id, params.violationId),
							});
						}),
					);

					if (!violation) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Violation not found",
									entityType: "timeRegulationViolation",
									entityId: params.violationId,
								}),
							),
						);
						return;
					}

					yield* _(
						dbService.query("acknowledgeViolation", async () => {
							await dbService.db
								.update(timeRegulationViolation)
								.set({
									acknowledgedBy: params.acknowledgedBy,
									acknowledgedAt: new Date(),
									acknowledgedNote: params.note,
								})
								.where(eq(timeRegulationViolation.id, params.violationId));
						}),
					);
				}),
		});
	}),
);
