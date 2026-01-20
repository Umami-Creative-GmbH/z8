"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import {
	type DeleteNonAdminResult,
	deleteNonAdminEmployeesData,
} from "@/lib/demo/delete-non-admin";
import {
	assignWorkCategoriesToPeriods,
	type ClearDataResult,
	clearOrganizationTimeData,
	type DemoDataOptions,
	type DemoDataResult,
	generateDemoAbsences,
	generateDemoChangePolicies,
	generateDemoData,
	generateDemoLocations,
	generateDemoManagerAssignments,
	generateDemoProjects,
	generateDemoShifts,
	generateDemoShiftTemplates,
	generateDemoTeams,
	generateDemoTimeEntries,
	generateDemoWorkCategories,
} from "@/lib/demo/demo-data.service";
import { type GenerateEmployeesResult, generateDemoEmployees } from "@/lib/demo/employee-generator";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";

/**
 * Check if user is org admin or owner
 */
async function isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
	const membership = await db.query.member.findFirst({
		where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
	});

	return membership?.role === "admin" || membership?.role === "owner";
}

export interface GenerateDemoDataInput {
	organizationId: string;
	dateRangeType: "last30" | "last60" | "last90" | "thisYear";
	includeTimeEntries: boolean;
	includeAbsences: boolean;
	includeTeams: boolean;
	teamCount?: number;
	includeProjects: boolean;
	projectCount?: number;
	employeeIds?: string[];
}

/**
 * Generate demo data for an organization
 */
export async function generateDemoDataAction(
	input: GenerateDemoDataInput,
): Promise<ServerActionResult<DemoDataResult>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get current employee
		const dbService = yield* _(DatabaseService);
		const _currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				const emp = await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
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

		// Step 3: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		// Step 4: Calculate date range
		const now = new Date();
		let startDate: Date;
		const endDate = new Date(now);

		switch (input.dateRangeType) {
			case "last30":
				startDate = new Date(now);
				startDate.setDate(startDate.getDate() - 30);
				break;
			case "last60":
				startDate = new Date(now);
				startDate.setDate(startDate.getDate() - 60);
				break;
			case "last90":
				startDate = new Date(now);
				startDate.setDate(startDate.getDate() - 90);
				break;
			case "thisYear":
				startDate = new Date(now.getFullYear(), 0, 1);
				break;
			default:
				startDate = new Date(now);
				startDate.setDate(startDate.getDate() - 30);
		}

		// Step 5: Generate demo data
		const result = yield* _(
			Effect.promise(() =>
				generateDemoData({
					organizationId: input.organizationId,
					dateRange: {
						start: startDate,
						end: endDate,
					},
					includeTimeEntries: input.includeTimeEntries,
					includeAbsences: input.includeAbsences,
					includeTeams: input.includeTeams,
					teamCount: input.teamCount,
					includeProjects: input.includeProjects,
					projectCount: input.projectCount,
					employeeIds: input.employeeIds,
					createdBy: session.user.id,
				}),
			),
		);

		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// Step-by-step generation actions for real progress tracking

export interface StepGenerationInput {
	organizationId: string;
	dateRangeType: "last30" | "last60" | "last90" | "thisYear";
	teamCount?: number;
	projectCount?: number;
	employeeIds?: string[];
	// NEW: Location options
	locationCount?: number;
	subareasPerLocation?: number;
	// NEW: Work category options
	workCategorySetCount?: number;
	workCategoryCount?: number;
	// NEW: Change policy options
	changePolicyCount?: number;
	// NEW: Shift scheduling options
	shiftTemplateCount?: number;
}

/**
 * Helper to calculate date range from type
 */
function calculateDateRange(dateRangeType: StepGenerationInput["dateRangeType"]): {
	start: Date;
	end: Date;
} {
	const now = new Date();
	let startDate: Date;
	const endDate = new Date(now);

	switch (dateRangeType) {
		case "last30":
			startDate = new Date(now);
			startDate.setDate(startDate.getDate() - 30);
			break;
		case "last60":
			startDate = new Date(now);
			startDate.setDate(startDate.getDate() - 60);
			break;
		case "last90":
			startDate = new Date(now);
			startDate.setDate(startDate.getDate() - 90);
			break;
		case "thisYear":
			startDate = new Date(now.getFullYear(), 0, 1);
			break;
		default:
			startDate = new Date(now);
			startDate.setDate(startDate.getDate() - 30);
	}

	return { start: startDate, end: endDate };
}

/**
 * Generate demo teams (step 1)
 */
export async function generateTeamsStepAction(
	input: StepGenerationInput,
): Promise<ServerActionResult<{ teamsCreated: number; employeesAssignedToTeams: number }>> {
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
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		const options: DemoDataOptions = {
			organizationId: input.organizationId,
			dateRange,
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: true,
			teamCount: input.teamCount,
			includeProjects: false,
			employeeIds: input.employeeIds,
			createdBy: session.user.id,
		};

		const result = yield* _(Effect.promise(() => generateDemoTeams(options)));
		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Generate demo projects (step 2)
 */
export async function generateProjectsStepAction(
	input: StepGenerationInput,
): Promise<ServerActionResult<{ projectsCreated: number }>> {
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
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		const options: DemoDataOptions = {
			organizationId: input.organizationId,
			dateRange,
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: true,
			projectCount: input.projectCount,
			employeeIds: input.employeeIds,
			createdBy: session.user.id,
		};

		const result = yield* _(Effect.promise(() => generateDemoProjects(options)));
		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Generate manager assignments (step 3)
 */
export async function generateManagersStepAction(
	input: StepGenerationInput,
): Promise<ServerActionResult<{ managerAssignmentsCreated: number }>> {
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
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		const options: DemoDataOptions = {
			organizationId: input.organizationId,
			dateRange,
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			employeeIds: input.employeeIds,
			createdBy: session.user.id,
		};

		const result = yield* _(Effect.promise(() => generateDemoManagerAssignments(options)));
		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Generate time entries (step 4)
 */
export async function generateTimeEntriesStepAction(
	input: StepGenerationInput,
): Promise<ServerActionResult<{ timeEntriesCreated: number; workPeriodsCreated: number }>> {
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
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		const options: DemoDataOptions = {
			organizationId: input.organizationId,
			dateRange,
			includeTimeEntries: true,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			employeeIds: input.employeeIds,
			createdBy: session.user.id,
		};

		const result = yield* _(Effect.promise(() => generateDemoTimeEntries(options)));
		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Generate absences (step 5)
 */
export async function generateAbsencesStepAction(
	input: StepGenerationInput,
): Promise<ServerActionResult<{ absencesCreated: number }>> {
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
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		const options: DemoDataOptions = {
			organizationId: input.organizationId,
			dateRange,
			includeTimeEntries: false,
			includeAbsences: true,
			includeTeams: false,
			includeProjects: false,
			employeeIds: input.employeeIds,
			createdBy: session.user.id,
		};

		const result = yield* _(Effect.promise(() => generateDemoAbsences(options)));
		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Generate demo locations (step 6)
 */
export async function generateLocationsStepAction(
	input: StepGenerationInput,
): Promise<
	ServerActionResult<{
		locationsCreated: number;
		subareasCreated: number;
		supervisorAssignmentsCreated: number;
	}>
> {
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
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		const options: DemoDataOptions = {
			organizationId: input.organizationId,
			dateRange,
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			includeLocations: true,
			locationCount: input.locationCount,
			subareasPerLocation: input.subareasPerLocation,
			employeeIds: input.employeeIds,
			createdBy: session.user.id,
		};

		const result = yield* _(Effect.promise(() => generateDemoLocations(options)));
		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Generate demo work categories (step 7)
 */
export async function generateWorkCategoriesStepAction(
	input: StepGenerationInput,
): Promise<
	ServerActionResult<{
		setsCreated: number;
		categoriesCreated: number;
		assignmentsCreated: number;
	}>
> {
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
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		const options: DemoDataOptions = {
			organizationId: input.organizationId,
			dateRange,
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			includeWorkCategories: true,
			workCategorySetCount: input.workCategorySetCount,
			workCategoryCount: input.workCategoryCount,
			employeeIds: input.employeeIds,
			createdBy: session.user.id,
		};

		const result = yield* _(Effect.promise(() => generateDemoWorkCategories(options)));
		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Generate demo change policies (step 8)
 */
export async function generateChangePoliciesStepAction(
	input: StepGenerationInput,
): Promise<
	ServerActionResult<{
		policiesCreated: number;
		assignmentsCreated: number;
	}>
> {
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
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		const options: DemoDataOptions = {
			organizationId: input.organizationId,
			dateRange,
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			includeChangePolicies: true,
			changePolicyCount: input.changePolicyCount,
			employeeIds: input.employeeIds,
			createdBy: session.user.id,
		};

		const result = yield* _(Effect.promise(() => generateDemoChangePolicies(options)));
		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Generate demo shift templates (step 9)
 */
export async function generateShiftTemplatesStepAction(
	input: StepGenerationInput,
): Promise<ServerActionResult<{ templatesCreated: number }>> {
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
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		const options: DemoDataOptions = {
			organizationId: input.organizationId,
			dateRange,
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			includeShifts: true,
			shiftTemplateCount: input.shiftTemplateCount,
			employeeIds: input.employeeIds,
			createdBy: session.user.id,
		};

		const result = yield* _(Effect.promise(() => generateDemoShiftTemplates(options)));
		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Generate demo shifts with recurrence (step 10)
 */
export async function generateShiftsStepAction(
	input: StepGenerationInput,
): Promise<
	ServerActionResult<{
		recurrencesCreated: number;
		shiftsCreated: number;
		requestsCreated: number;
	}>
> {
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
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		const options: DemoDataOptions = {
			organizationId: input.organizationId,
			dateRange,
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			includeShifts: true,
			generateShiftInstances: true,
			employeeIds: input.employeeIds,
			createdBy: session.user.id,
		};

		const result = yield* _(Effect.promise(() => generateDemoShifts(options)));
		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Assign work categories to existing work periods (step 11)
 */
export async function assignWorkCategoriesToPeriodsStepAction(
	input: StepGenerationInput,
): Promise<ServerActionResult<{ workCategoriesAssigned: number }>> {
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
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		const options: DemoDataOptions = {
			organizationId: input.organizationId,
			dateRange,
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			assignWorkCategoriesToPeriods: true,
			employeeIds: input.employeeIds,
			createdBy: session.user.id,
		};

		const result = yield* _(Effect.promise(() => assignWorkCategoriesToPeriods(options)));
		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Clear all time-related data for an organization
 */
export async function clearTimeDataAction(
	organizationId: string,
): Promise<ServerActionResult<ClearDataResult>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get current employee
		const dbService = yield* _(DatabaseService);
		const _currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				const emp = await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
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

		// Step 3: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "demo_data",
						action: "clear",
					}),
				),
			);
		}

		// Step 4: Clear all time data
		const result = yield* _(Effect.promise(() => clearOrganizationTimeData(organizationId)));

		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get employees list for the organization (for the employee selector)
 */
export async function getOrganizationEmployees(
	organizationId: string,
): Promise<ServerActionResult<Array<{ id: string; name: string }>>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "employees",
						action: "read",
					}),
				),
			);
		}

		// Step 3: Get employees
		const dbService = yield* _(DatabaseService);
		const employees = yield* _(
			dbService.query("getEmployees", async () => {
				return await dbService.db.query.employee.findMany({
					where: eq(employee.organizationId, organizationId),
					with: {
						user: true,
					},
				});
			}),
		);

		return employees.map((emp) => ({
			id: emp.id,
			name: emp.user?.name || emp.userId,
		}));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export interface GenerateDemoEmployeesInput {
	organizationId: string;
	count: number;
	includeManagers: boolean;
}

/**
 * Generate demo employees with fake user accounts
 */
export async function generateDemoEmployeesAction(
	input: GenerateDemoEmployeesInput,
): Promise<ServerActionResult<GenerateEmployeesResult>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "demo_employees",
						action: "generate",
					}),
				),
			);
		}

		// Step 3: Generate demo employees
		const result = yield* _(
			Effect.promise(() =>
				generateDemoEmployees({
					organizationId: input.organizationId,
					count: input.count,
					includeManagers: input.includeManagers,
				}),
			),
		);

		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete all non-admin employees and their data
 */
export async function deleteNonAdminDataAction(
	organizationId: string,
): Promise<ServerActionResult<DeleteNonAdminResult>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "non_admin_data",
						action: "delete",
					}),
				),
			);
		}

		// Step 3: Delete non-admin data
		const result = yield* _(
			Effect.promise(() => deleteNonAdminEmployeesData(organizationId, session.user.id)),
		);

		return result;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
