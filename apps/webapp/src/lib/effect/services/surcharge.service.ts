import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import { organization } from "@/db/auth-schema";
import {
	employee,
	type SurchargeCalculationDetails,
	surchargeCalculation,
	type surchargeModel,
	surchargeModelAssignment,
	type surchargeRule,
	workPeriod,
} from "@/db/schema";
import { DatabaseError, NotFoundError } from "../errors";
import { DatabaseService } from "./database.service";

// ============================================
// TYPES
// ============================================

export type EffectiveSurchargeModel = {
	modelId: string;
	modelName: string;
	rules: Array<{
		id: string;
		name: string;
		ruleType: "day_of_week" | "time_window" | "date_based";
		percentage: string; // decimal string e.g., "0.5000"
		dayOfWeek?: string | null;
		windowStartTime?: string | null;
		windowEndTime?: string | null;
		specificDate?: Date | null;
		dateRangeStart?: Date | null;
		dateRangeEnd?: Date | null;
		priority: number;
		validFrom?: Date | null;
		validUntil?: Date | null;
	}>;
	assignmentType: "organization" | "team" | "employee";
	assignedVia: string;
};

export type SurchargeCalculationResult = {
	baseMinutes: number;
	qualifyingMinutes: number;
	surchargeMinutes: number;
	totalCreditedMinutes: number;
	appliedRules: Array<{
		ruleId: string;
		ruleName: string;
		ruleType: string;
		percentage: number;
		qualifyingMinutes: number;
		surchargeMinutes: number;
	}>;
};

export type SurchargeSummary = {
	employeeId: string;
	period: { start: Date; end: Date };
	baseMinutes: number;
	totalSurchargeMinutes: number;
	totalCreditedMinutes: number;
	byRuleType: Record<string, { minutes: number; count: number }>;
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if a given timestamp falls within a time window.
 * Handles windows that span midnight (e.g., 22:00-06:00).
 */
function isWithinTimeWindow(timestamp: DateTime, windowStart: string, windowEnd: string): boolean {
	const [startHour, startMin] = windowStart.split(":").map(Number);
	const [endHour, endMin] = windowEnd.split(":").map(Number);

	const currentMinutes = timestamp.hour * 60 + timestamp.minute;
	const startMinutes = startHour * 60 + startMin;
	const endMinutes = endHour * 60 + endMin;

	if (startMinutes <= endMinutes) {
		// Normal window (e.g., 09:00-17:00)
		return currentMinutes >= startMinutes && currentMinutes < endMinutes;
	} else {
		// Spans midnight (e.g., 22:00-06:00)
		return currentMinutes >= startMinutes || currentMinutes < endMinutes;
	}
}

/**
 * Check if a rule applies to a given minute timestamp.
 */
function ruleAppliesToMinute(rule: EffectiveSurchargeModel["rules"][0], minute: DateTime): boolean {
	// Check validity period
	if (rule.validFrom && minute.toJSDate() < rule.validFrom) return false;
	if (rule.validUntil && minute.toJSDate() > rule.validUntil) return false;

	switch (rule.ruleType) {
		case "day_of_week": {
			const dayMap: Record<string, number> = {
				monday: 1,
				tuesday: 2,
				wednesday: 3,
				thursday: 4,
				friday: 5,
				saturday: 6,
				sunday: 7,
			};
			return rule.dayOfWeek ? minute.weekday === dayMap[rule.dayOfWeek] : false;
		}

		case "time_window": {
			if (!rule.windowStartTime || !rule.windowEndTime) return false;
			return isWithinTimeWindow(minute, rule.windowStartTime, rule.windowEndTime);
		}

		case "date_based": {
			const minuteDate = minute.startOf("day");
			if (rule.specificDate) {
				const ruleDate = DateTime.fromJSDate(rule.specificDate).startOf("day");
				return minuteDate.equals(ruleDate);
			}
			if (rule.dateRangeStart && rule.dateRangeEnd) {
				const rangeStart = DateTime.fromJSDate(rule.dateRangeStart).startOf("day");
				const rangeEnd = DateTime.fromJSDate(rule.dateRangeEnd).startOf("day");
				return minuteDate >= rangeStart && minuteDate <= rangeEnd;
			}
			return false;
		}

		default:
			return false;
	}
}

/**
 * Calculate surcharges for a work period using "max wins" overlap policy.
 * For each minute, the highest applicable percentage wins.
 */
function calculateSurchargesInternal(
	startTime: Date,
	endTime: Date,
	rules: EffectiveSurchargeModel["rules"],
	timezone: string = "UTC",
): SurchargeCalculationResult {
	const start = DateTime.fromJSDate(startTime, { zone: timezone });
	const end = DateTime.fromJSDate(endTime, { zone: timezone });
	const totalMinutes = Math.floor(end.diff(start, "minutes").minutes);

	if (totalMinutes <= 0 || rules.length === 0) {
		return {
			baseMinutes: Math.max(0, totalMinutes),
			qualifyingMinutes: 0,
			surchargeMinutes: 0,
			totalCreditedMinutes: Math.max(0, totalMinutes),
			appliedRules: [],
		};
	}

	// Track qualifying minutes per rule
	const ruleQualifyingMinutes: Map<string, number> = new Map();

	// For each minute in the work period
	for (let i = 0; i < totalMinutes; i++) {
		const currentMinute = start.plus({ minutes: i });

		// Find all applicable rules for this minute
		const applicableRules = rules.filter((rule) => ruleAppliesToMinute(rule, currentMinute));

		if (applicableRules.length > 0) {
			// "Max wins" - use highest percentage
			const maxRule = applicableRules.reduce((max, rule) =>
				parseFloat(rule.percentage) > parseFloat(max.percentage) ? rule : max,
			);

			ruleQualifyingMinutes.set(maxRule.id, (ruleQualifyingMinutes.get(maxRule.id) ?? 0) + 1);
		}
	}

	// Calculate surcharge minutes per rule
	const appliedRules: SurchargeCalculationResult["appliedRules"] = [];
	let totalQualifyingMinutes = 0;
	let totalSurchargeMinutes = 0;

	for (const rule of rules) {
		const qualifyingMinutes = ruleQualifyingMinutes.get(rule.id) ?? 0;
		if (qualifyingMinutes > 0) {
			const percentage = parseFloat(rule.percentage);
			const surchargeMinutes = Math.round(qualifyingMinutes * percentage);

			appliedRules.push({
				ruleId: rule.id,
				ruleName: rule.name,
				ruleType: rule.ruleType,
				percentage,
				qualifyingMinutes,
				surchargeMinutes,
			});

			totalQualifyingMinutes += qualifyingMinutes;
			totalSurchargeMinutes += surchargeMinutes;
		}
	}

	return {
		baseMinutes: totalMinutes,
		qualifyingMinutes: totalQualifyingMinutes,
		surchargeMinutes: totalSurchargeMinutes,
		totalCreditedMinutes: totalMinutes + totalSurchargeMinutes,
		appliedRules,
	};
}

// ============================================
// SERVICE INTERFACE
// ============================================

export class SurchargeService extends Context.Tag("SurchargeService")<
	SurchargeService,
	{
		/**
		 * Get the effective surcharge model for an employee.
		 * Resolves hierarchical assignments: employee > team > organization.
		 */
		readonly getEffectiveSurchargeModel: (
			employeeId: string,
		) => Effect.Effect<EffectiveSurchargeModel | null, NotFoundError | DatabaseError>;

		/**
		 * Calculate surcharges for a completed work period.
		 * Returns calculation results without persisting.
		 */
		readonly calculateSurcharges: (
			workPeriodId: string,
		) => Effect.Effect<SurchargeCalculationResult | null, NotFoundError | DatabaseError>;

		/**
		 * Calculate and persist surcharge calculation for a work period.
		 * Called on clock-out.
		 */
		readonly persistSurchargeCalculation: (
			workPeriodId: string,
		) => Effect.Effect<SurchargeCalculationResult | null, NotFoundError | DatabaseError>;

		/**
		 * Recalculate surcharges for a work period (e.g., after correction).
		 * Replaces existing calculation.
		 */
		readonly recalculateSurcharges: (
			workPeriodId: string,
		) => Effect.Effect<SurchargeCalculationResult | null, NotFoundError | DatabaseError>;

		/**
		 * Get surcharge credits for an employee in a date range.
		 */
		readonly getSurchargeCreditsForPeriod: (
			employeeId: string,
			startDate: Date,
			endDate: Date,
		) => Effect.Effect<SurchargeSummary, DatabaseError>;

		/**
		 * Check if surcharges are enabled for an organization.
		 */
		readonly isSurchargesEnabled: (organizationId: string) => Effect.Effect<boolean, DatabaseError>;
	}
>() {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const SurchargeServiceLive = Layer.effect(
	SurchargeService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		// Helper to map raw model + rules to EffectiveSurchargeModel
		const mapToEffective = (
			model: typeof surchargeModel.$inferSelect & {
				rules: (typeof surchargeRule.$inferSelect)[];
			},
			assignmentType: "organization" | "team" | "employee",
			assignedVia: string,
		): EffectiveSurchargeModel => ({
			modelId: model.id,
			modelName: model.name,
			rules: model.rules
				.filter((rule) => rule.isActive)
				.sort((a, b) => b.priority - a.priority) // Higher priority first
				.map((rule) => ({
					id: rule.id,
					name: rule.name,
					ruleType: rule.ruleType,
					percentage: rule.percentage,
					dayOfWeek: rule.dayOfWeek,
					windowStartTime: rule.windowStartTime,
					windowEndTime: rule.windowEndTime,
					specificDate: rule.specificDate,
					dateRangeStart: rule.dateRangeStart,
					dateRangeEnd: rule.dateRangeEnd,
					priority: rule.priority,
					validFrom: rule.validFrom,
					validUntil: rule.validUntil,
				})),
			assignmentType,
			assignedVia,
		});

		return SurchargeService.of({
			getEffectiveSurchargeModel: (employeeId) =>
				Effect.gen(function* (_) {
					// 1. Get employee with team info
					const emp = yield* _(
						dbService.query("getEmployeeForSurcharge", async () => {
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

					// 2. Check employee-level assignment (priority 2 - highest)
					const employeeAssignment = yield* _(
						dbService.query("getEmployeeSurchargeAssignment", async () => {
							return await dbService.db.query.surchargeModelAssignment.findFirst({
								where: and(
									eq(surchargeModelAssignment.employeeId, employeeId),
									eq(surchargeModelAssignment.assignmentType, "employee"),
									eq(surchargeModelAssignment.isActive, true),
									or(
										isNull(surchargeModelAssignment.effectiveFrom),
										lte(surchargeModelAssignment.effectiveFrom, now),
									),
									or(
										isNull(surchargeModelAssignment.effectiveUntil),
										gte(surchargeModelAssignment.effectiveUntil, now),
									),
								),
								with: {
									model: {
										with: {
											rules: true,
										},
									},
								},
							});
						}),
					);

					if (employeeAssignment?.model?.isActive) {
						return mapToEffective(employeeAssignment.model, "employee", "Individual");
					}

					// 3. Check team-level assignment (priority 1)
					if (emp.teamId) {
						const teamAssignment = yield* _(
							dbService.query("getTeamSurchargeAssignment", async () => {
								return await dbService.db.query.surchargeModelAssignment.findFirst({
									where: and(
										eq(surchargeModelAssignment.teamId, emp.teamId!),
										eq(surchargeModelAssignment.assignmentType, "team"),
										eq(surchargeModelAssignment.isActive, true),
										or(
											isNull(surchargeModelAssignment.effectiveFrom),
											lte(surchargeModelAssignment.effectiveFrom, now),
										),
										or(
											isNull(surchargeModelAssignment.effectiveUntil),
											gte(surchargeModelAssignment.effectiveUntil, now),
										),
									),
									with: {
										model: {
											with: {
												rules: true,
											},
										},
										team: true,
									},
								});
							}),
						);

						if (teamAssignment?.model?.isActive) {
							return mapToEffective(
								teamAssignment.model,
								"team",
								teamAssignment.team?.name ?? "Team",
							);
						}
					}

					// 4. Check organization-level assignment (priority 0 - lowest)
					const orgAssignment = yield* _(
						dbService.query("getOrgSurchargeAssignment", async () => {
							return await dbService.db.query.surchargeModelAssignment.findFirst({
								where: and(
									eq(surchargeModelAssignment.organizationId, emp.organizationId),
									eq(surchargeModelAssignment.assignmentType, "organization"),
									eq(surchargeModelAssignment.isActive, true),
									or(
										isNull(surchargeModelAssignment.effectiveFrom),
										lte(surchargeModelAssignment.effectiveFrom, now),
									),
									or(
										isNull(surchargeModelAssignment.effectiveUntil),
										gte(surchargeModelAssignment.effectiveUntil, now),
									),
								),
								with: {
									model: {
										with: {
											rules: true,
										},
									},
								},
							});
						}),
					);

					if (orgAssignment?.model?.isActive) {
						return mapToEffective(orgAssignment.model, "organization", "Organization Default");
					}

					// No surcharge model assigned
					return null;
				}),

			calculateSurcharges: (workPeriodId) =>
				Effect.gen(function* (_) {
					// Get work period with employee info
					const period = yield* _(
						dbService.query("getWorkPeriodForSurcharge", async () => {
							return await dbService.db.query.workPeriod.findFirst({
								where: eq(workPeriod.id, workPeriodId),
								with: {
									employee: true,
								},
							});
						}),
					);

					if (!period) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Work period not found",
									entityType: "workPeriod",
									entityId: workPeriodId,
								}),
							),
						);
						return null;
					}

					// Work period must be completed (have endTime)
					if (!period.endTime) {
						return null; // Cannot calculate surcharges for active period
					}

					// Get effective surcharge model
					const effectiveModel = yield* _(
						Effect.tryPromise({
							try: async () => {
								// Inline resolution to avoid recursive call issues
								const emp = period.employee;
								if (!emp) return null;

								const now = new Date();

								// Employee-level
								const employeeAssignment =
									await dbService.db.query.surchargeModelAssignment.findFirst({
										where: and(
											eq(surchargeModelAssignment.employeeId, emp.id),
											eq(surchargeModelAssignment.assignmentType, "employee"),
											eq(surchargeModelAssignment.isActive, true),
											or(
												isNull(surchargeModelAssignment.effectiveFrom),
												lte(surchargeModelAssignment.effectiveFrom, now),
											),
											or(
												isNull(surchargeModelAssignment.effectiveUntil),
												gte(surchargeModelAssignment.effectiveUntil, now),
											),
										),
										with: {
											model: { with: { rules: true } },
										},
									});

								if (employeeAssignment?.model?.isActive) {
									return mapToEffective(employeeAssignment.model, "employee", "Individual");
								}

								// Team-level
								if (emp.teamId) {
									const teamAssignment =
										await dbService.db.query.surchargeModelAssignment.findFirst({
											where: and(
												eq(surchargeModelAssignment.teamId, emp.teamId),
												eq(surchargeModelAssignment.assignmentType, "team"),
												eq(surchargeModelAssignment.isActive, true),
												or(
													isNull(surchargeModelAssignment.effectiveFrom),
													lte(surchargeModelAssignment.effectiveFrom, now),
												),
												or(
													isNull(surchargeModelAssignment.effectiveUntil),
													gte(surchargeModelAssignment.effectiveUntil, now),
												),
											),
											with: {
												model: { with: { rules: true } },
												team: true,
											},
										});

									if (teamAssignment?.model?.isActive) {
										return mapToEffective(
											teamAssignment.model,
											"team",
											teamAssignment.team?.name ?? "Team",
										);
									}
								}

								// Org-level
								const orgAssignment = await dbService.db.query.surchargeModelAssignment.findFirst({
									where: and(
										eq(surchargeModelAssignment.organizationId, emp.organizationId),
										eq(surchargeModelAssignment.assignmentType, "organization"),
										eq(surchargeModelAssignment.isActive, true),
										or(
											isNull(surchargeModelAssignment.effectiveFrom),
											lte(surchargeModelAssignment.effectiveFrom, now),
										),
										or(
											isNull(surchargeModelAssignment.effectiveUntil),
											gte(surchargeModelAssignment.effectiveUntil, now),
										),
									),
									with: {
										model: { with: { rules: true } },
									},
								});

								if (orgAssignment?.model?.isActive) {
									return mapToEffective(
										orgAssignment.model,
										"organization",
										"Organization Default",
									);
								}

								return null;
							},
							catch: (error) =>
								new DatabaseError({
									message: "Failed to resolve surcharge model",
									operation: "calculateSurcharges",
									cause: error,
								}),
						}),
					);

					if (!effectiveModel || effectiveModel.rules.length === 0) {
						return null;
					}

					// Calculate surcharges
					// TODO: Get timezone from organization settings
					const result = calculateSurchargesInternal(
						period.startTime,
						period.endTime,
						effectiveModel.rules,
						"UTC",
					);

					return result;
				}),

			persistSurchargeCalculation: (workPeriodId) =>
				Effect.gen(function* (_) {
					// Get work period with employee info
					const period = yield* _(
						dbService.query("getWorkPeriodForPersist", async () => {
							return await dbService.db.query.workPeriod.findFirst({
								where: eq(workPeriod.id, workPeriodId),
								with: {
									employee: true,
								},
							});
						}),
					);

					if (!period || !period.endTime || !period.employee) {
						return null;
					}

					// Check if calculation already exists
					const existing = yield* _(
						dbService.query("checkExistingSurchargeCalc", async () => {
							return await dbService.db.query.surchargeCalculation.findFirst({
								where: eq(surchargeCalculation.workPeriodId, workPeriodId),
							});
						}),
					);

					if (existing) {
						// Already calculated, return existing data
						return {
							baseMinutes: existing.baseMinutes,
							qualifyingMinutes: existing.qualifyingMinutes,
							surchargeMinutes: existing.surchargeMinutes,
							totalCreditedMinutes: existing.baseMinutes + existing.surchargeMinutes,
							appliedRules:
								(existing.calculationDetails as SurchargeCalculationDetails | null)?.rulesApplied ??
								[],
						};
					}

					// Get effective model using Effect.tryPromise to wrap async calls
					const emp = period.employee;
					const effectiveModel = yield* _(
						Effect.tryPromise({
							try: async () => {
								const now = new Date();

								// Employee-level
								const employeeAssignment =
									await dbService.db.query.surchargeModelAssignment.findFirst({
										where: and(
											eq(surchargeModelAssignment.employeeId, emp.id),
											eq(surchargeModelAssignment.assignmentType, "employee"),
											eq(surchargeModelAssignment.isActive, true),
											or(
												isNull(surchargeModelAssignment.effectiveFrom),
												lte(surchargeModelAssignment.effectiveFrom, now),
											),
											or(
												isNull(surchargeModelAssignment.effectiveUntil),
												gte(surchargeModelAssignment.effectiveUntil, now),
											),
										),
										with: {
											model: { with: { rules: true } },
										},
									});

								if (employeeAssignment?.model?.isActive) {
									return mapToEffective(employeeAssignment.model, "employee", "Individual");
								}

								// Team-level
								if (emp.teamId) {
									const teamAssignment =
										await dbService.db.query.surchargeModelAssignment.findFirst({
											where: and(
												eq(surchargeModelAssignment.teamId, emp.teamId),
												eq(surchargeModelAssignment.assignmentType, "team"),
												eq(surchargeModelAssignment.isActive, true),
												or(
													isNull(surchargeModelAssignment.effectiveFrom),
													lte(surchargeModelAssignment.effectiveFrom, now),
												),
												or(
													isNull(surchargeModelAssignment.effectiveUntil),
													gte(surchargeModelAssignment.effectiveUntil, now),
												),
											),
											with: {
												model: { with: { rules: true } },
												team: true,
											},
										});

									if (teamAssignment?.model?.isActive) {
										return mapToEffective(
											teamAssignment.model,
											"team",
											teamAssignment.team?.name ?? "Team",
										);
									}
								}

								// Org-level
								const orgAssignment = await dbService.db.query.surchargeModelAssignment.findFirst({
									where: and(
										eq(surchargeModelAssignment.organizationId, emp.organizationId),
										eq(surchargeModelAssignment.assignmentType, "organization"),
										eq(surchargeModelAssignment.isActive, true),
										or(
											isNull(surchargeModelAssignment.effectiveFrom),
											lte(surchargeModelAssignment.effectiveFrom, now),
										),
										or(
											isNull(surchargeModelAssignment.effectiveUntil),
											gte(surchargeModelAssignment.effectiveUntil, now),
										),
									),
									with: {
										model: { with: { rules: true } },
									},
								});

								if (orgAssignment?.model?.isActive) {
									return mapToEffective(
										orgAssignment.model,
										"organization",
										"Organization Default",
									);
								}

								return null;
							},
							catch: (error) =>
								new DatabaseError({
									message: "Failed to resolve surcharge model",
									operation: "persistSurchargeCalculation",
									cause: error,
								}),
						}),
					);

					if (!effectiveModel || effectiveModel.rules.length === 0) {
						return null;
					}

					// Calculate surcharges
					const result = calculateSurchargesInternal(
						period.startTime,
						period.endTime,
						effectiveModel.rules,
						"UTC",
					);

					if (result.surchargeMinutes === 0) {
						return result; // No surcharges to persist
					}

					// Persist calculation
					const primaryRule = result.appliedRules[0];
					const calculationDetails: SurchargeCalculationDetails = {
						workPeriodStartTime: period.startTime.toISOString(),
						workPeriodEndTime: period.endTime.toISOString(),
						rulesApplied: result.appliedRules,
						overlapPolicy: "max_wins",
						calculatedAt: new Date().toISOString(),
					};

					yield* _(
						dbService.query("insertSurchargeCalculation", async () => {
							await dbService.db.insert(surchargeCalculation).values({
								employeeId: emp.id,
								organizationId: emp.organizationId,
								workPeriodId: workPeriodId,
								surchargeRuleId: primaryRule?.ruleId ?? null,
								surchargeModelId: effectiveModel!.modelId,
								calculationDate: new Date(),
								baseMinutes: result.baseMinutes,
								qualifyingMinutes: result.qualifyingMinutes,
								surchargeMinutes: result.surchargeMinutes,
								appliedPercentage: primaryRule?.percentage?.toString() ?? "0",
								calculationDetails: calculationDetails,
							});
						}),
					);

					return result;
				}),

			recalculateSurcharges: (workPeriodId) =>
				Effect.gen(function* (_) {
					// Delete existing calculation
					yield* _(
						dbService.query("deleteExistingSurchargeCalc", async () => {
							await dbService.db
								.delete(surchargeCalculation)
								.where(eq(surchargeCalculation.workPeriodId, workPeriodId));
						}),
					);

					// Re-calculate and persist
					// Use inline calculation to avoid recursive service calls
					const period = yield* _(
						dbService.query("getWorkPeriodForRecalc", async () => {
							return await dbService.db.query.workPeriod.findFirst({
								where: eq(workPeriod.id, workPeriodId),
								with: {
									employee: true,
								},
							});
						}),
					);

					if (!period || !period.endTime || !period.employee) {
						return null;
					}

					const emp = period.employee;

					// Resolve effective model using hierarchical lookup
					const effectiveModel = yield* _(
						Effect.tryPromise({
							try: async () => {
								const now = new Date();
								let model: EffectiveSurchargeModel | null = null;

								// Same resolution logic as persistSurchargeCalculation
								const employeeAssignment =
									await dbService.db.query.surchargeModelAssignment.findFirst({
										where: and(
											eq(surchargeModelAssignment.employeeId, emp.id),
											eq(surchargeModelAssignment.assignmentType, "employee"),
											eq(surchargeModelAssignment.isActive, true),
											or(
												isNull(surchargeModelAssignment.effectiveFrom),
												lte(surchargeModelAssignment.effectiveFrom, now),
											),
											or(
												isNull(surchargeModelAssignment.effectiveUntil),
												gte(surchargeModelAssignment.effectiveUntil, now),
											),
										),
										with: { model: { with: { rules: true } } },
									});

								if (employeeAssignment?.model?.isActive) {
									model = mapToEffective(employeeAssignment.model, "employee", "Individual");
								}

								if (!model && emp.teamId) {
									const teamAssignment =
										await dbService.db.query.surchargeModelAssignment.findFirst({
											where: and(
												eq(surchargeModelAssignment.teamId, emp.teamId),
												eq(surchargeModelAssignment.assignmentType, "team"),
												eq(surchargeModelAssignment.isActive, true),
												or(
													isNull(surchargeModelAssignment.effectiveFrom),
													lte(surchargeModelAssignment.effectiveFrom, now),
												),
												or(
													isNull(surchargeModelAssignment.effectiveUntil),
													gte(surchargeModelAssignment.effectiveUntil, now),
												),
											),
											with: {
												model: { with: { rules: true } },
												team: true,
											},
										});

									if (teamAssignment?.model?.isActive) {
										model = mapToEffective(
											teamAssignment.model,
											"team",
											teamAssignment.team?.name ?? "Team",
										);
									}
								}

								if (!model) {
									const orgAssignment = await dbService.db.query.surchargeModelAssignment.findFirst(
										{
											where: and(
												eq(surchargeModelAssignment.organizationId, emp.organizationId),
												eq(surchargeModelAssignment.assignmentType, "organization"),
												eq(surchargeModelAssignment.isActive, true),
												or(
													isNull(surchargeModelAssignment.effectiveFrom),
													lte(surchargeModelAssignment.effectiveFrom, now),
												),
												or(
													isNull(surchargeModelAssignment.effectiveUntil),
													gte(surchargeModelAssignment.effectiveUntil, now),
												),
											),
											with: { model: { with: { rules: true } } },
										},
									);

									if (orgAssignment?.model?.isActive) {
										model = mapToEffective(
											orgAssignment.model,
											"organization",
											"Organization Default",
										);
									}
								}

								return model;
							},
							catch: (error) =>
								new DatabaseError({
									message: "Failed to resolve surcharge model",
									operation: "recalculateSurcharges",
									cause: error,
								}),
						}),
					);

					if (!effectiveModel || effectiveModel.rules.length === 0) {
						return null;
					}

					const result = calculateSurchargesInternal(
						period.startTime,
						period.endTime,
						effectiveModel.rules,
						"UTC",
					);

					if (result.surchargeMinutes > 0) {
						const primaryRule = result.appliedRules[0];
						const calculationDetails: SurchargeCalculationDetails = {
							workPeriodStartTime: period.startTime.toISOString(),
							workPeriodEndTime: period.endTime.toISOString(),
							rulesApplied: result.appliedRules,
							overlapPolicy: "max_wins",
							calculatedAt: new Date().toISOString(),
						};

						yield* _(
							dbService.query("insertRecalculatedSurcharge", async () => {
								await dbService.db.insert(surchargeCalculation).values({
									employeeId: emp.id,
									organizationId: emp.organizationId,
									workPeriodId: workPeriodId,
									surchargeRuleId: primaryRule?.ruleId ?? null,
									surchargeModelId: effectiveModel!.modelId,
									calculationDate: new Date(),
									baseMinutes: result.baseMinutes,
									qualifyingMinutes: result.qualifyingMinutes,
									surchargeMinutes: result.surchargeMinutes,
									appliedPercentage: primaryRule?.percentage?.toString() ?? "0",
									calculationDetails: calculationDetails,
								});
							}),
						);
					}

					return result;
				}),

			getSurchargeCreditsForPeriod: (employeeId, startDate, endDate) =>
				Effect.gen(function* (_) {
					const calculations = yield* _(
						dbService.query("getSurchargeCreditsForPeriod", async () => {
							return await dbService.db.query.surchargeCalculation.findMany({
								where: and(
									eq(surchargeCalculation.employeeId, employeeId),
									gte(surchargeCalculation.calculationDate, startDate),
									lte(surchargeCalculation.calculationDate, endDate),
								),
							});
						}),
					);

					let baseMinutes = 0;
					let totalSurchargeMinutes = 0;
					const byRuleType: Record<string, { minutes: number; count: number }> = {};

					for (const calc of calculations) {
						baseMinutes += calc.baseMinutes;
						totalSurchargeMinutes += calc.surchargeMinutes;

						// Aggregate by rule type from details
						const details = calc.calculationDetails as SurchargeCalculationDetails | null;
						if (details?.rulesApplied) {
							for (const rule of details.rulesApplied) {
								if (!byRuleType[rule.ruleType]) {
									byRuleType[rule.ruleType] = { minutes: 0, count: 0 };
								}
								byRuleType[rule.ruleType].minutes += rule.surchargeMinutes;
								byRuleType[rule.ruleType].count += 1;
							}
						}
					}

					return {
						employeeId,
						period: { start: startDate, end: endDate },
						baseMinutes,
						totalSurchargeMinutes,
						totalCreditedMinutes: baseMinutes + totalSurchargeMinutes,
						byRuleType,
					};
				}),

			isSurchargesEnabled: (organizationId) =>
				Effect.gen(function* (_) {
					const org = yield* _(
						dbService.query("checkSurchargesEnabled", async () => {
							return await dbService.db.query.organization.findFirst({
								where: eq(organization.id, organizationId),
								columns: {
									surchargesEnabled: true,
								},
							});
						}),
					);

					return org?.surchargesEnabled ?? false;
				}),
		});
	}),
);
