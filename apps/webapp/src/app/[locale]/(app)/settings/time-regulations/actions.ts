"use server";

import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Effect } from "effect";
import {
	employee,
	team,
	timeRegulation,
	timeRegulationAssignment,
	timeRegulationBreakOption,
	timeRegulationBreakRule,
	timeRegulationPreset,
	timeRegulationViolation,
	type TimeRegulationBreakRulesPreset,
} from "@/db/schema";
import { AuthorizationError, DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	timeRegulationAssignmentFormSchema,
	timeRegulationFormSchema,
	type TimeRegulationAssignmentFormValues,
	type TimeRegulationFormValues,
} from "@/lib/time-regulations/validation";

// ============================================
// TYPES
// ============================================

export type TimeRegulationWithRules = typeof timeRegulation.$inferSelect & {
	breakRules: (typeof timeRegulationBreakRule.$inferSelect & {
		options: (typeof timeRegulationBreakOption.$inferSelect)[];
	})[];
};

export type TimeRegulationAssignmentWithDetails = typeof timeRegulationAssignment.$inferSelect & {
	regulation: { id: string; name: string } | null;
	team: { id: string; name: string } | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
};

export type TimeRegulationViolationWithDetails = typeof timeRegulationViolation.$inferSelect & {
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
	regulation: { id: string; name: string } | null;
};

// Type aliases for components
export type TimeRegulationWithBreakRules = TimeRegulationWithRules;
export type TimeRegulationAssignmentWithRelations = typeof timeRegulationAssignment.$inferSelect & {
	regulation: {
		id: string;
		name: string;
		maxDailyMinutes: number | null;
		maxWeeklyMinutes: number | null;
		maxUninterruptedMinutes: number | null;
		breakRules: (typeof timeRegulationBreakRule.$inferSelect)[];
	};
	team: { id: string; name: string } | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
};
export type ViolationSummary = TimeRegulationViolationWithDetails;

// ============================================
// GET REGULATIONS
// ============================================

/**
 * Get all time regulations for an organization
 */
export async function getTimeRegulations(
	organizationId: string,
): Promise<ServerActionResult<TimeRegulationWithRules[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const regulations = yield* _(
			dbService.query("getTimeRegulations", async () => {
				return await dbService.db.query.timeRegulation.findMany({
					where: and(
						eq(timeRegulation.organizationId, organizationId),
						eq(timeRegulation.isActive, true),
					),
					with: {
						breakRules: {
							orderBy: [timeRegulationBreakRule.sortOrder],
							with: {
								options: {
									orderBy: [timeRegulationBreakOption.sortOrder],
								},
							},
						},
					},
					orderBy: [desc(timeRegulation.createdAt)],
				});
			}),
		);

		return regulations;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get a single time regulation with all details
 */
export async function getTimeRegulation(
	regulationId: string,
): Promise<ServerActionResult<TimeRegulationWithRules | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const regulation = yield* _(
			dbService.query("getTimeRegulation", async () => {
				return await dbService.db.query.timeRegulation.findFirst({
					where: eq(timeRegulation.id, regulationId),
					with: {
						breakRules: {
							orderBy: [timeRegulationBreakRule.sortOrder],
							with: {
								options: {
									orderBy: [timeRegulationBreakOption.sortOrder],
								},
							},
						},
					},
				});
			}),
		);

		return regulation ?? null;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// CREATE REGULATION
// ============================================

/**
 * Create a new time regulation with break rules
 */
export async function createTimeRegulation(
	organizationId: string,
	data: TimeRegulationFormValues,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee and verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "time_regulation",
						action: "create",
					}),
				),
			);
		}

		// Validate input
		const validationResult = timeRegulationFormSchema.safeParse(data);
		if (!validationResult.success) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: validationResult.error.issues[0]?.message ?? "Invalid input",
						field: validationResult.error.issues[0]?.path.join("."),
					}),
				),
			);
		}

		// Create regulation
		const [regulation] = yield* _(
			dbService.query("createTimeRegulation", async () => {
				return await dbService.db
					.insert(timeRegulation)
					.values({
						organizationId: organizationId,
						name: data.name,
						description: data.description,
						maxDailyMinutes: data.maxDailyMinutes,
						maxWeeklyMinutes: data.maxWeeklyMinutes,
						maxUninterruptedMinutes: data.maxUninterruptedMinutes,
						isActive: data.isActive,
						createdBy: session.user.id,
					})
					.returning();
			}),
		);

		// Create break rules with options
		for (const [ruleIndex, rule] of data.breakRules.entries()) {
			const [breakRule] = yield* _(
				dbService.query("createBreakRule", async () => {
					return await dbService.db
						.insert(timeRegulationBreakRule)
						.values({
							regulationId: regulation.id,
							workingMinutesThreshold: rule.workingMinutesThreshold,
							requiredBreakMinutes: rule.requiredBreakMinutes,
							sortOrder: ruleIndex,
						})
						.returning();
				}),
			);

			// Create options for this rule
			for (const [optIndex, option] of rule.options.entries()) {
				yield* _(
					dbService.query("createBreakOption", async () => {
						await dbService.db.insert(timeRegulationBreakOption).values({
							breakRuleId: breakRule.id,
							splitCount: option.splitCount,
							minimumSplitMinutes: option.minimumSplitMinutes,
							minimumLongestSplitMinutes: option.minimumLongestSplitMinutes,
							sortOrder: optIndex,
						});
					}),
				);
			}
		}

		return { id: regulation.id };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// UPDATE REGULATION
// ============================================

/**
 * Update an existing time regulation
 */
export async function updateTimeRegulation(
	regulationId: string,
	data: TimeRegulationFormValues,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee and verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "time_regulation",
						action: "update",
					}),
				),
			);
		}

		// Verify regulation exists and belongs to org
		const existingRegulation = yield* _(
			dbService.query("verifyRegulation", async () => {
				const [reg] = await dbService.db
					.select()
					.from(timeRegulation)
					.where(
						and(
							eq(timeRegulation.id, regulationId),
							eq(timeRegulation.organizationId, employeeRecord.organizationId),
						),
					)
					.limit(1);

				if (!reg) throw new Error("Regulation not found");
				return reg;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Time regulation not found",
						entityType: "time_regulation",
						entityId: regulationId,
					}),
			),
		);

		// Update regulation
		yield* _(
			dbService.query("updateTimeRegulation", async () => {
				await dbService.db
					.update(timeRegulation)
					.set({
						name: data.name,
						description: data.description,
						maxDailyMinutes: data.maxDailyMinutes,
						maxWeeklyMinutes: data.maxWeeklyMinutes,
						maxUninterruptedMinutes: data.maxUninterruptedMinutes,
						isActive: data.isActive,
						updatedBy: session.user.id,
					})
					.where(eq(timeRegulation.id, regulationId));
			}),
		);

		// Delete existing break rules (cascade deletes options)
		yield* _(
			dbService.query("deleteOldBreakRules", async () => {
				await dbService.db
					.delete(timeRegulationBreakRule)
					.where(eq(timeRegulationBreakRule.regulationId, regulationId));
			}),
		);

		// Recreate break rules with options
		for (const [ruleIndex, rule] of data.breakRules.entries()) {
			const [breakRule] = yield* _(
				dbService.query("createBreakRule", async () => {
					return await dbService.db
						.insert(timeRegulationBreakRule)
						.values({
							regulationId: regulationId,
							workingMinutesThreshold: rule.workingMinutesThreshold,
							requiredBreakMinutes: rule.requiredBreakMinutes,
							sortOrder: ruleIndex,
						})
						.returning();
				}),
			);

			for (const [optIndex, option] of rule.options.entries()) {
				yield* _(
					dbService.query("createBreakOption", async () => {
						await dbService.db.insert(timeRegulationBreakOption).values({
							breakRuleId: breakRule.id,
							splitCount: option.splitCount,
							minimumSplitMinutes: option.minimumSplitMinutes,
							minimumLongestSplitMinutes: option.minimumLongestSplitMinutes,
							sortOrder: optIndex,
						});
					}),
				);
			}
		}
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// DELETE REGULATION
// ============================================

/**
 * Soft delete a time regulation
 */
export async function deleteTimeRegulation(regulationId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee and verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "time_regulation",
						action: "delete",
					}),
				),
			);
		}

		// Soft delete
		yield* _(
			dbService.query("deleteTimeRegulation", async () => {
				await dbService.db
					.update(timeRegulation)
					.set({ isActive: false, updatedBy: session.user.id })
					.where(
						and(
							eq(timeRegulation.id, regulationId),
							eq(timeRegulation.organizationId, employeeRecord.organizationId),
						),
					);
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// ASSIGNMENTS
// ============================================

/**
 * Get all assignments for an organization
 */
export async function getTimeRegulationAssignments(
	organizationId: string,
): Promise<ServerActionResult<TimeRegulationAssignmentWithDetails[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const assignments = yield* _(
			dbService.query("getTimeRegulationAssignments", async () => {
				return await dbService.db.query.timeRegulationAssignment.findMany({
					where: and(
						eq(timeRegulationAssignment.organizationId, organizationId),
						eq(timeRegulationAssignment.isActive, true),
					),
					with: {
						regulation: {
							columns: {
								id: true,
								name: true,
								maxDailyMinutes: true,
								maxWeeklyMinutes: true,
								maxUninterruptedMinutes: true,
							},
							with: {
								breakRules: true,
							},
						},
						team: {
							columns: { id: true, name: true },
						},
						employee: {
							columns: { id: true, firstName: true, lastName: true },
						},
					},
					orderBy: [desc(timeRegulationAssignment.createdAt)],
				});
			}),
		);

		return assignments as TimeRegulationAssignmentWithRelations[];
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Create a new assignment
 */
export async function createTimeRegulationAssignment(
	organizationId: string,
	data: Omit<TimeRegulationAssignmentFormValues, "effectiveFrom" | "effectiveUntil" | "isActive">,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee and verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "time_regulation_assignment",
						action: "create",
					}),
				),
			);
		}

		// Determine priority based on assignment type
		const priority = data.assignmentType === "employee" ? 2 : data.assignmentType === "team" ? 1 : 0;

		// Create assignment
		const [assignment] = yield* _(
			dbService.query("createTimeRegulationAssignment", async () => {
				return await dbService.db
					.insert(timeRegulationAssignment)
					.values({
						regulationId: data.regulationId,
						organizationId: organizationId,
						assignmentType: data.assignmentType,
						teamId: data.teamId ?? null,
						employeeId: data.employeeId ?? null,
						priority,
						isActive: true,
						createdBy: session.user.id,
					})
					.returning();
			}),
		);

		return { id: assignment.id };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete an assignment (soft delete)
 */
export async function deleteTimeRegulationAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee and verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "time_regulation_assignment",
						action: "delete",
					}),
				),
			);
		}

		// Soft delete
		yield* _(
			dbService.query("deleteTimeRegulationAssignment", async () => {
				await dbService.db
					.update(timeRegulationAssignment)
					.set({ isActive: false })
					.where(
						and(
							eq(timeRegulationAssignment.id, assignmentId),
							eq(timeRegulationAssignment.organizationId, employeeRecord.organizationId),
						),
					);
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// PRESETS
// ============================================

/**
 * Get all available presets
 */
export async function getTimeRegulationPresets(): Promise<
	ServerActionResult<(typeof timeRegulationPreset.$inferSelect)[]>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const presets = yield* _(
			dbService.query("getTimeRegulationPresets", async () => {
				return await dbService.db.query.timeRegulationPreset.findMany({
					where: eq(timeRegulationPreset.isActive, true),
					orderBy: [timeRegulationPreset.name],
				});
			}),
		);

		return presets;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Import a preset as a new regulation for the organization
 */
export async function importPresetToOrganization(
	presetId: string,
	organizationId: string,
	setAsOrgDefault?: boolean,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee and verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "time_regulation",
						action: "import",
					}),
				),
			);
		}

		// Get preset
		const preset = yield* _(
			dbService.query("getPreset", async () => {
				return await dbService.db.query.timeRegulationPreset.findFirst({
					where: eq(timeRegulationPreset.id, presetId),
				});
			}),
		);

		if (!preset) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Preset not found",
						entityType: "time_regulation_preset",
						entityId: presetId,
					}),
				),
			);
			return { id: "" }; // TypeScript needs this
		}

		// Create regulation from preset
		const [regulation] = yield* _(
			dbService.query("createRegulationFromPreset", async () => {
				return await dbService.db
					.insert(timeRegulation)
					.values({
						organizationId: organizationId,
						name: preset.name,
						description: preset.description,
						maxDailyMinutes: preset.maxDailyMinutes,
						maxWeeklyMinutes: preset.maxWeeklyMinutes,
						maxUninterruptedMinutes: preset.maxUninterruptedMinutes,
						createdBy: session.user.id,
					})
					.returning();
			}),
		);

		// Create break rules from preset JSON
		if (preset.breakRulesJson) {
			const breakRulesData =
				typeof preset.breakRulesJson === "string"
					? (JSON.parse(preset.breakRulesJson) as TimeRegulationBreakRulesPreset)
					: (preset.breakRulesJson as TimeRegulationBreakRulesPreset);

			for (const [ruleIndex, rule] of breakRulesData.rules.entries()) {
				const [breakRule] = yield* _(
					dbService.query("createBreakRuleFromPreset", async () => {
						return await dbService.db
							.insert(timeRegulationBreakRule)
							.values({
								regulationId: regulation.id,
								workingMinutesThreshold: rule.workingMinutesThreshold,
								requiredBreakMinutes: rule.requiredBreakMinutes,
								sortOrder: ruleIndex,
							})
							.returning();
					}),
				);

				for (const [optIndex, option] of rule.options.entries()) {
					yield* _(
						dbService.query("createBreakOptionFromPreset", async () => {
							await dbService.db.insert(timeRegulationBreakOption).values({
								breakRuleId: breakRule.id,
								splitCount: option.splitCount,
								minimumSplitMinutes: option.minimumSplitMinutes,
								minimumLongestSplitMinutes: option.minimumLongestSplitMinutes,
								sortOrder: optIndex,
							});
						}),
					);
				}
			}
		}

		// Optionally set as org default
		if (setAsOrgDefault) {
			yield* _(
				dbService.query("createOrgDefaultAssignment", async () => {
					await dbService.db.insert(timeRegulationAssignment).values({
						regulationId: regulation.id,
						organizationId: organizationId,
						assignmentType: "organization",
						priority: 0,
						createdBy: session.user.id,
					});
				}),
			);
		}

		return { id: regulation.id };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// VIOLATIONS
// ============================================

/**
 * Get violations summary for reporting
 */
export async function getViolationsSummary(
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<ServerActionResult<TimeRegulationViolationWithDetails[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const violations = yield* _(
			dbService.query("getViolationsSummary", async () => {
				return await dbService.db.query.timeRegulationViolation.findMany({
					where: and(
						eq(timeRegulationViolation.organizationId, organizationId),
						gte(timeRegulationViolation.violationDate, startDate),
						lte(timeRegulationViolation.violationDate, endDate),
					),
					with: {
						employee: {
							columns: { id: true, firstName: true, lastName: true },
						},
						regulation: {
							columns: { id: true, name: true },
						},
					},
					orderBy: [desc(timeRegulationViolation.violationDate)],
				});
			}),
		);

		return violations as TimeRegulationViolationWithDetails[];
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Acknowledge a violation
 */
export async function acknowledgeViolation(
	violationId: string,
	note?: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Update violation
		yield* _(
			dbService.query("acknowledgeViolation", async () => {
				await dbService.db
					.update(timeRegulationViolation)
					.set({
						acknowledgedBy: employeeRecord.id,
						acknowledgedAt: new Date(),
						acknowledgedNote: note,
					})
					.where(
						and(
							eq(timeRegulationViolation.id, violationId),
							eq(timeRegulationViolation.organizationId, employeeRecord.organizationId),
						),
					);
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
