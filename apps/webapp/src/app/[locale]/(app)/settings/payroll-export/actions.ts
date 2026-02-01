"use server";

import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import {
	absenceCategory,
	db,
	payrollExportConfig,
	payrollExportFormat,
	payrollWageTypeMapping,
	workCategory,
} from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	createExportJob,
	processExportJob,
	getExportJobHistory,
	getExportDownloadUrl,
	getPayrollExportConfig,
	getWageTypeMappings,
	getWorkCategories,
	getAbsenceCategories,
	getEmployeesForFilter,
	getTeamsForFilter,
	getProjectsForFilter,
	type PayrollExportFilters,
	type DatevLohnConfig,
	type WageTypeMapping,
	type PayrollExportJobSummary,
} from "@/lib/payroll-export";

/**
 * Check if user is org admin or owner
 */
async function isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
	const membership = await db.query.member.findFirst({
		where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
	});

	return membership?.role === "admin" || membership?.role === "owner";
}

// ============================================
// CONFIGURATION TYPES
// ============================================

export interface DatevConfigResult {
	id: string;
	formatId: string;
	config: DatevLohnConfig;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface SaveDatevConfigInput {
	organizationId: string;
	config: DatevLohnConfig;
}

// ============================================
// WAGE TYPE MAPPING TYPES
// ============================================

export interface SaveMappingInput {
	organizationId: string;
	configId: string;
	workCategoryId?: string | null;
	absenceCategoryId?: string | null;
	specialCategory?: string | null;
	wageTypeCode: string;
	wageTypeName?: string;
}

export interface DeleteMappingInput {
	organizationId: string;
	mappingId: string;
}

// ============================================
// EXPORT TYPES
// ============================================

export interface StartExportInput {
	organizationId: string;
	startDate: string; // ISO date
	endDate: string; // ISO date
	employeeIds?: string[];
	teamIds?: string[];
	projectIds?: string[];
}

// ============================================
// FILTER OPTIONS TYPES
// ============================================

export interface FilterOptions {
	employees: Array<{ id: string; firstName: string | null; lastName: string | null; employeeNumber: string | null }>;
	teams: Array<{ id: string; name: string }>;
	projects: Array<{ id: string; name: string }>;
}

// ============================================
// CONFIGURATION ACTIONS
// ============================================

/**
 * Get DATEV configuration for organization
 */
export async function getDatevConfigAction(
	organizationId: string,
): Promise<ServerActionResult<DatevConfigResult | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "read",
					}),
				),
			);
		}

		const configResult = yield* _(
			Effect.promise(() => getPayrollExportConfig(organizationId, "datev_lohn")),
		);

		if (!configResult) {
			return null;
		}

		return {
			id: configResult.config.id,
			formatId: configResult.config.formatId,
			config: configResult.config.config as unknown as DatevLohnConfig,
			isActive: configResult.config.isActive,
			createdAt: configResult.config.createdAt,
			updatedAt: configResult.config.updatedAt,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Save DATEV configuration
 */
export async function saveDatevConfigAction(
	input: SaveDatevConfigInput,
): Promise<ServerActionResult<DatevConfigResult>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "create",
					}),
				),
			);
		}

		// Ensure DATEV format exists
		yield* _(
			Effect.promise(async () => {
				const format = await db.query.payrollExportFormat.findFirst({
					where: eq(payrollExportFormat.id, "datev_lohn"),
				});

				if (!format) {
					// Create the format if it doesn't exist
					await db.insert(payrollExportFormat).values({
						id: "datev_lohn",
						name: "DATEV Lohn & Gehalt",
						version: "2024.1",
						description: "Export for DATEV payroll software",
						isEnabled: true,
						requiresConfiguration: true,
						supportsAsync: true,
						syncThreshold: 500,
						updatedAt: new Date(),
					});
				}
			}),
		);

		// Save or update config
		const config = yield* _(
			Effect.promise(async () => {
				const existing = await db.query.payrollExportConfig.findFirst({
					where: and(
						eq(payrollExportConfig.organizationId, input.organizationId),
						eq(payrollExportConfig.formatId, "datev_lohn"),
					),
				});

				if (existing) {
					const [updated] = await db
						.update(payrollExportConfig)
						.set({
							config: input.config as unknown as Record<string, unknown>,
							updatedBy: session.user.id,
						})
						.where(eq(payrollExportConfig.id, existing.id))
						.returning();

					return updated;
				} else {
					const [inserted] = await db
						.insert(payrollExportConfig)
						.values({
							organizationId: input.organizationId,
							formatId: "datev_lohn",
							config: input.config as unknown as Record<string, unknown>,
							isActive: true,
							createdBy: session.user.id,
							updatedAt: new Date(),
						})
						.returning();

					return inserted;
				}
			}),
		);

		revalidatePath("/settings/payroll-export");

		return {
			id: config.id,
			formatId: config.formatId,
			config: config.config as unknown as DatevLohnConfig,
			isActive: config.isActive,
			createdAt: config.createdAt,
			updatedAt: config.updatedAt,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// WAGE TYPE MAPPING ACTIONS
// ============================================

/**
 * Get wage type mappings for organization's DATEV config
 */
export async function getMappingsAction(
	organizationId: string,
): Promise<ServerActionResult<WageTypeMapping[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_wage_type_mapping",
						action: "read",
					}),
				),
			);
		}

		// Get config first
		const configResult = yield* _(
			Effect.promise(() => getPayrollExportConfig(organizationId, "datev_lohn")),
		);

		if (!configResult) {
			return [];
		}

		// Get mappings
		const mappings = yield* _(
			Effect.promise(() => getWageTypeMappings(configResult.config.id)),
		);

		return mappings;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Save a wage type mapping
 */
export async function saveMappingAction(
	input: SaveMappingInput,
): Promise<ServerActionResult<WageTypeMapping>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_wage_type_mapping",
						action: "create",
					}),
				),
			);
		}

		// Validate that exactly one source is provided
		const sourceCount = [
			input.workCategoryId,
			input.absenceCategoryId,
			input.specialCategory,
		].filter(Boolean).length;

		if (sourceCount !== 1) {
			throw new Error("Exactly one of workCategoryId, absenceCategoryId, or specialCategory must be provided");
		}

		// Validate organization ownership of category IDs
		yield* _(
			Effect.promise(async () => {
				if (input.workCategoryId) {
					const category = await db.query.workCategory.findFirst({
						where: and(
							eq(workCategory.id, input.workCategoryId),
							eq(workCategory.organizationId, input.organizationId),
						),
					});
					if (!category) {
						throw new Error("Work category not found or access denied");
					}
				}

				if (input.absenceCategoryId) {
					const category = await db.query.absenceCategory.findFirst({
						where: and(
							eq(absenceCategory.id, input.absenceCategoryId),
							eq(absenceCategory.organizationId, input.organizationId),
						),
					});
					if (!category) {
						throw new Error("Absence category not found or access denied");
					}
				}
			}),
		);

		// Save mapping
		const mapping = yield* _(
			Effect.promise(async () => {
				// Check for existing mapping with same source
				const whereConditions = [eq(payrollWageTypeMapping.configId, input.configId)];

				if (input.workCategoryId) {
					whereConditions.push(eq(payrollWageTypeMapping.workCategoryId, input.workCategoryId));
				} else if (input.absenceCategoryId) {
					whereConditions.push(eq(payrollWageTypeMapping.absenceCategoryId, input.absenceCategoryId));
				} else if (input.specialCategory) {
					whereConditions.push(eq(payrollWageTypeMapping.specialCategory, input.specialCategory));
				}

				const existing = await db.query.payrollWageTypeMapping.findFirst({
					where: and(...whereConditions),
				});

				if (existing) {
					// Update existing
					const [updated] = await db
						.update(payrollWageTypeMapping)
						.set({
							wageTypeCode: input.wageTypeCode,
							wageTypeName: input.wageTypeName || null,
							isActive: true,
						})
						.where(eq(payrollWageTypeMapping.id, existing.id))
						.returning();

					return updated;
				} else {
					// Insert new
					const [inserted] = await db
						.insert(payrollWageTypeMapping)
						.values({
							configId: input.configId,
							workCategoryId: input.workCategoryId || null,
							absenceCategoryId: input.absenceCategoryId || null,
							specialCategory: input.specialCategory || null,
							wageTypeCode: input.wageTypeCode,
							wageTypeName: input.wageTypeName || null,
							isActive: true,
							createdBy: session.user.id,
							updatedAt: new Date(),
						})
						.returning();

					return inserted;
				}
			}),
		);

		revalidatePath("/settings/payroll-export");

		return {
			id: mapping.id,
			workCategoryId: mapping.workCategoryId,
			workCategoryName: null, // Not loaded here
			absenceCategoryId: mapping.absenceCategoryId,
			absenceCategoryName: null, // Not loaded here
			specialCategory: mapping.specialCategory,
			wageTypeCode: mapping.wageTypeCode,
			wageTypeName: mapping.wageTypeName,
			factor: mapping.factor || "1.00",
			isActive: mapping.isActive,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Delete a wage type mapping
 */
export async function deleteMappingAction(
	input: DeleteMappingInput,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_wage_type_mapping",
						action: "delete",
					}),
				),
			);
		}

		yield* _(
			Effect.promise(async () => {
				await db
					.delete(payrollWageTypeMapping)
					.where(eq(payrollWageTypeMapping.id, input.mappingId));
			}),
		);

		revalidatePath("/settings/payroll-export");
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// CATEGORY OPTIONS ACTIONS
// ============================================

/**
 * Get work categories for mapping selection
 */
export async function getWorkCategoriesAction(
	organizationId: string,
): Promise<ServerActionResult<Array<{ id: string; name: string; factor: string | null }>>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "work_category",
						action: "read",
					}),
				),
			);
		}

		const categories = yield* _(
			Effect.promise(() => getWorkCategories(organizationId)),
		);

		return categories;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Get absence categories for mapping selection
 */
export async function getAbsenceCategoriesAction(
	organizationId: string,
): Promise<ServerActionResult<Array<{ id: string; name: string; type: string | null }>>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "absence_category",
						action: "read",
					}),
				),
			);
		}

		const categories = yield* _(
			Effect.promise(() => getAbsenceCategories(organizationId)),
		);

		return categories;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// FILTER OPTIONS ACTION
// ============================================

/**
 * Get filter options (employees, teams, projects)
 */
export async function getFilterOptionsAction(
	organizationId: string,
): Promise<ServerActionResult<FilterOptions>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "filter_options",
						action: "read",
					}),
				),
			);
		}

		const [employees, teams, projects] = yield* _(
			Effect.promise(() =>
				Promise.all([
					getEmployeesForFilter(organizationId),
					getTeamsForFilter(organizationId),
					getProjectsForFilter(organizationId),
				]),
			),
		);

		return { employees, teams, projects };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// EXPORT ACTIONS
// ============================================

/**
 * Start a payroll export
 */
export async function startExportAction(
	input: StartExportInput,
): Promise<ServerActionResult<{ jobId: string; isAsync: boolean; downloadUrl?: string; fileContent?: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Get current employee
		const dbService = yield* _(DatabaseService);
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				const emp = await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, input.organizationId),
					),
				});

				if (!emp) {
					throw new Error("Employee not found");
				}

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

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export",
						action: "create",
					}),
				),
			);
		}

		// Parse and validate dates
		const startDate = DateTime.fromISO(input.startDate);
		const endDate = DateTime.fromISO(input.endDate);

		if (!startDate.isValid || !endDate.isValid) {
			throw new Error("Invalid date format provided");
		}

		if (endDate < startDate) {
			throw new Error("End date must be after start date");
		}

		const filters: PayrollExportFilters = {
			dateRange: {
				start: startDate,
				end: endDate,
			},
			employeeIds: input.employeeIds,
			teamIds: input.teamIds,
			projectIds: input.projectIds,
		};

		// Create export job
		const { jobId, isAsync } = yield* _(
			Effect.promise(() =>
				createExportJob({
					organizationId: input.organizationId,
					formatId: "datev_lohn",
					requestedById: currentEmployee.id,
					filters,
				}),
			),
		);

		// If sync, process immediately and return result
		if (!isAsync) {
			const { result, downloadUrl } = yield* _(
				Effect.promise(() => processExportJob(jobId)),
			);

			revalidatePath("/settings/payroll-export");

			return {
				jobId,
				isAsync: false,
				downloadUrl,
				fileContent: result?.content ? (typeof result.content === "string" ? result.content : result.content.toString("utf-8")) : undefined,
			};
		}

		// For async, just return job ID
		revalidatePath("/settings/payroll-export");

		return { jobId, isAsync: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Get export history
 */
export async function getExportHistoryAction(
	organizationId: string,
): Promise<ServerActionResult<PayrollExportJobSummary[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export",
						action: "read",
					}),
				),
			);
		}

		const history = yield* _(
			Effect.promise(() => getExportJobHistory(organizationId)),
		);

		return history;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Get download URL for export
 */
export async function getExportDownloadUrlAction(
	organizationId: string,
	jobId: string,
): Promise<ServerActionResult<string | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export",
						action: "download",
					}),
				),
			);
		}

		const url = yield* _(
			Effect.promise(() => getExportDownloadUrl(organizationId, jobId)),
		);

		return url;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
