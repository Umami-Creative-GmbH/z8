"use server";

import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import {
	absenceEntry,
	clockodoProjectMapping,
	clockodoUserMapping,
	customer,
	employee,
	holiday,
	project,
	surchargeModel,
	team,
	workCategory,
	workPeriod,
	workPolicy,
} from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { runActiveOrganizationActionActorCheck } from "@/lib/auth/organization-action-authorization";
import { requireUser } from "@/lib/auth-helpers";
import { ClockodoClient } from "@/lib/clockodo/client";
import type {
	ClockodoDataPreview,
	ImportResult,
	ImportUserMapping,
	ImportSelections,
	ProjectMappingEntry,
	SavedProjectMapping,
	UserMappingEntry,
} from "@/lib/clockodo/types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ClockodoImportActions");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// TYPES
// ============================================

type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export interface ExistingDataCounts {
	employees: number;
	teams: number;
	workCategories: number;
	workPeriods: number;
	absences: number;
	workPolicies: number;
	holidays: number;
	surcharges: number;
}

export interface ClockodoUserInfo {
	id: number;
	name: string;
	email: string;
	active: boolean;
}

export interface Z8EmployeeInfo {
	id: string;
	userId: string;
	name: string;
	email: string;
}

// ============================================
// HELPERS
// ============================================

async function requireAdmin(organizationId: string) {
	const authContext = await requireUser();
	await runActiveOrganizationActionActorCheck({
		userId: authContext.user.id,
		organizationId,
		requiredRole: "admin",
		message: "Only active approved admins and owners can manage imports",
		resource: "clockodoImport",
		action: "manage",
	});

	return authContext;
}

/**
 * Validates that all provided employee IDs belong to the given organization.
 * Prevents cross-org data writes via tampered client requests.
 */
async function validateEmployeeOwnership(
	employeeIds: string[],
	organizationId: string,
): Promise<void> {
	if (employeeIds.length === 0) return;

	const validEmployees = await db
		.select({ id: employee.id })
		.from(employee)
		.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, employeeIds)));

	const validIds = new Set(validEmployees.map((e) => e.id));
	const invalidIds = employeeIds.filter((id) => !validIds.has(id));

	if (invalidIds.length > 0) {
		throw new Error("One or more employee IDs do not belong to this organization");
	}
}

// ============================================
// VALIDATE CREDENTIALS & PREVIEW
// ============================================

export async function validateClockodoCredentials(
	email: string,
	apiKey: string,
	organizationId: string,
): Promise<ActionResult<ClockodoDataPreview>> {
	try {
		if (!email?.trim() || !apiKey?.trim()) {
			return { success: false, error: "Email and API key are required" };
		}

		await requireAdmin(organizationId);

		const client = new ClockodoClient(email.trim(), apiKey.trim());

		// Test connection
		const connected = await client.testConnection();
		if (!connected) {
			return {
				success: false,
				error: "Invalid credentials. Check your Clockodo email and API key.",
			};
		}

		// Fetch data counts in parallel
		const [
			users,
			teams,
			services,
			entriesCount,
			absencesCount,
			targetHours,
			holidayQuotas,
			nonBusinessDays,
			surcharges,
		] = await Promise.all([
			client.getUsers(),
			client.getTeams(),
			client.getServices(),
			client.getEntriesCount(),
			client.getAbsencesCount(),
			client.getTargetHours(),
			client.getHolidayQuotas(),
			client.getNonBusinessDays(),
			client.getSurcharges(),
		]);

		const preview: ClockodoDataPreview = {
			users: users.length,
			teams: teams.length,
			services: services.length,
			entries: entriesCount,
			absences: absencesCount,
			targetHours: targetHours.length,
			holidayQuotas: holidayQuotas.length,
			nonBusinessDays: nonBusinessDays.length,
			surcharges: surcharges.length,
		};

		logger.info({ organizationId, preview }, "Clockodo credentials validated");

		return { success: true, data: preview };
	} catch (error) {
		logger.error({ error }, "Clockodo validation failed");
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to validate credentials",
		};
	}
}

// ============================================
// FETCH CLOCKODO USERS
// ============================================

export async function fetchClockodoUsers(
	email: string,
	apiKey: string,
	organizationId: string,
): Promise<ActionResult<ClockodoUserInfo[]>> {
	try {
		await requireAdmin(organizationId);

		const client = new ClockodoClient(email.trim(), apiKey.trim());
		const users = await client.getUsers();

		return {
			success: true,
			data: users.map((u) => ({
				id: u.id,
				name: u.name,
				email: u.email,
				active: u.active,
			})),
		};
	} catch (error) {
		logger.error({ error }, "Failed to fetch Clockodo users");
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to fetch users",
		};
	}
}

// ============================================
// FETCH Z8 EMPLOYEES
// ============================================

export async function fetchZ8Employees(
	organizationId: string,
): Promise<ActionResult<Z8EmployeeInfo[]>> {
	try {
		await requireAdmin(organizationId);

		const employees = await db
			.select({
				id: employee.id,
				userId: employee.userId,
				firstName: authSchema.user.firstName,
				lastName: authSchema.user.lastName,
				email: authSchema.user.email,
				userName: authSchema.user.name,
			})
			.from(employee)
			.innerJoin(authSchema.user, eq(employee.userId, authSchema.user.id))
			.where(eq(employee.organizationId, organizationId));

		return {
			success: true,
			data: employees.map((e) => ({
				id: e.id,
				userId: e.userId,
				name: buildAuthUserDisplayName({
					firstName: e.firstName,
					lastName: e.lastName,
					name: e.userName,
					email: e.email,
				}),
				email: e.email,
			})),
		};
	} catch (error) {
		logger.error({ error }, "Failed to fetch Z8 employees");
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to fetch employees",
		};
	}
}

// ============================================
// SAVE USER MAPPINGS
// ============================================

export async function saveUserMappings(
	organizationId: string,
	mappings: UserMappingEntry[],
): Promise<ActionResult> {
	try {
		const authContext = await requireAdmin(organizationId);

		// Validate that all referenced employee IDs belong to this organization
		const employeeIds = mappings.map((m) => m.employeeId).filter((id): id is string => id != null);
		await validateEmployeeOwnership(employeeIds, organizationId);

		await Promise.all(
			mappings.map((mapping) =>
				db
					.insert(clockodoUserMapping)
					.values({
						organizationId,
						clockodoUserId: mapping.clockodoUserId,
						clockodoUserName: mapping.clockodoUserName,
						clockodoUserEmail: mapping.clockodoUserEmail,
						userId: mapping.userId,
						employeeId: mapping.employeeId,
						mappingType: mapping.mappingType,
						createdBy: authContext.user.id,
					})
					.onConflictDoUpdate({
						target: [clockodoUserMapping.organizationId, clockodoUserMapping.clockodoUserId],
						set: {
							clockodoUserName: mapping.clockodoUserName,
							clockodoUserEmail: mapping.clockodoUserEmail,
							userId: mapping.userId,
							employeeId: mapping.employeeId,
							mappingType: mapping.mappingType,
						},
					}),
			),
		);

		logger.info({ organizationId, count: mappings.length }, "User mappings saved");

		return { success: true, data: undefined };
	} catch (error) {
		logger.error({ error }, "Failed to save user mappings");
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to save mappings",
		};
	}
}

// ============================================
// PROJECT MAPPING (#907)
// ============================================

export interface ClockodoProjectInfo {
	id: number;
	name: string;
	customerName: string | null;
	active: boolean;
}

export interface Z8ProjectInfo {
	id: string;
	name: string;
	customerName: string | null;
	isActive: boolean;
}

export interface ProjectMappingData {
	clockodoProjects: ClockodoProjectInfo[];
	z8Projects: Z8ProjectInfo[];
	savedMappings: SavedProjectMapping[];
}

/**
 * Clockodo's projects, the organization's existing Z8 projects and the mappings
 * saved by earlier imports, for the project-mapping step.
 */
export async function fetchProjectMappingData(
	email: string,
	apiKey: string,
	organizationId: string,
): Promise<ActionResult<ProjectMappingData>> {
	try {
		await requireAdmin(organizationId);

		const client = new ClockodoClient(email.trim(), apiKey.trim());
		const [clockodoProjects, clockodoCustomers, z8Projects, savedMappings] = await Promise.all([
			client.getProjects(),
			client.getCustomers(),
			db
				.select({
					id: project.id,
					name: project.name,
					customerName: customer.name,
					isActive: project.isActive,
				})
				.from(project)
				.leftJoin(
					customer,
					and(eq(customer.id, project.customerId), eq(customer.organizationId, organizationId)),
				)
				.where(eq(project.organizationId, organizationId))
				.orderBy(asc(project.name)),
			db
				.select({
					clockodoProjectId: clockodoProjectMapping.clockodoProjectId,
					projectId: clockodoProjectMapping.projectId,
				})
				.from(clockodoProjectMapping)
				.where(eq(clockodoProjectMapping.organizationId, organizationId)),
		]);
		const customerNames = new Map(clockodoCustomers.map((entry) => [entry.id, entry.name]));

		return {
			success: true,
			data: {
				clockodoProjects: clockodoProjects.map((entry) => ({
					id: entry.id,
					name: entry.name,
					customerName: customerNames.get(entry.customers_id) ?? null,
					active: entry.active,
				})),
				z8Projects,
				savedMappings,
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to fetch Clockodo project mapping data");
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to fetch projects",
		};
	}
}

/**
 * Saves the organization's Clockodo project mappings. Mapped projects must be
 * existing projects of the organization; an entry without a project removes its
 * mapping. Projects are never created.
 */
export async function saveProjectMappings(
	organizationId: string,
	mappings: ProjectMappingEntry[],
): Promise<ActionResult> {
	try {
		const authContext = await requireAdmin(organizationId);

		if (
			!Array.isArray(mappings) ||
			mappings.some(
				(mapping) =>
					!Number.isSafeInteger(mapping?.clockodoProjectId) ||
					typeof mapping.clockodoProjectName !== "string" ||
					(mapping.projectId !== null &&
						(typeof mapping.projectId !== "string" || !UUID_PATTERN.test(mapping.projectId))),
			)
		) {
			return { success: false, error: "Invalid project mappings" };
		}
		const mapped = mappings.flatMap((mapping) =>
			mapping.projectId === null ? [] : [{ ...mapping, projectId: mapping.projectId }],
		);
		const unmappedIds = mappings
			.filter((mapping) => mapping.projectId === null)
			.map((mapping) => mapping.clockodoProjectId);
		await validateProjectOwnership(
			mapped.map((mapping) => mapping.projectId),
			organizationId,
		);

		await db.transaction(async (tx) => {
			if (unmappedIds.length > 0) {
				await tx
					.delete(clockodoProjectMapping)
					.where(
						and(
							eq(clockodoProjectMapping.organizationId, organizationId),
							inArray(clockodoProjectMapping.clockodoProjectId, unmappedIds),
						),
					);
			}
			for (const mapping of mapped) {
				await tx
					.insert(clockodoProjectMapping)
					.values({
						organizationId,
						clockodoProjectId: mapping.clockodoProjectId,
						clockodoProjectName: mapping.clockodoProjectName,
						projectId: mapping.projectId,
						createdBy: authContext.user.id,
					})
					.onConflictDoUpdate({
						target: [
							clockodoProjectMapping.organizationId,
							clockodoProjectMapping.clockodoProjectId,
						],
						set: {
							clockodoProjectName: mapping.clockodoProjectName,
							projectId: mapping.projectId,
						},
					});
			}
		});

		logger.info({ organizationId, mapped: mapped.length }, "Project mappings saved");

		return { success: true, data: undefined };
	} catch (error) {
		logger.error({ error }, "Failed to save project mappings");
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to save project mappings",
		};
	}
}

/** Refuses project IDs outside the organization (tampered client requests). */
async function validateProjectOwnership(projectIds: string[], organizationId: string) {
	const uniqueIds = [...new Set(projectIds)];
	if (uniqueIds.length === 0) return;
	const valid = await db
		.select({ id: project.id })
		.from(project)
		.where(and(eq(project.organizationId, organizationId), inArray(project.id, uniqueIds)));
	if (valid.length !== uniqueIds.length) {
		throw new Error("One or more projects do not belong to this organization");
	}
}

// ============================================
// RUN IMPORT
// ============================================

export async function importClockodoData(
	_email: string,
	_apiKey: string,
	_organizationId: string,
	_selections: ImportSelections,
	_serializedMappings?: ImportUserMapping[],
	_onlyImportMapped?: boolean,
): Promise<ActionResult<ImportResult>> {
	return {
		success: false,
		error: "Direct Clockodo imports are disabled. Start an import review scan instead.",
	};
}

// ============================================
// GET EXISTING DATA COUNTS
// ============================================

export async function getExistingDataCounts(
	organizationId: string,
): Promise<ActionResult<ExistingDataCounts>> {
	try {
		await requireAdmin(organizationId);

		const [
			employeeCount,
			teamCount,
			workCategoryCount,
			workPeriodCount,
			absenceCount,
			workPolicyCount,
			holidayCount,
			surchargeCount,
		] = await Promise.all([
			db
				.select({ count: count() })
				.from(employee)
				.where(eq(employee.organizationId, organizationId)),
			db.select({ count: count() }).from(team).where(eq(team.organizationId, organizationId)),
			db
				.select({ count: count() })
				.from(workCategory)
				.where(eq(workCategory.organizationId, organizationId)),
			db
				.select({ count: count() })
				.from(workPeriod)
				.where(eq(workPeriod.organizationId, organizationId)),
			db
				.select({ count: count() })
				.from(absenceEntry)
				.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
				.where(eq(employee.organizationId, organizationId)),
			db
				.select({ count: count() })
				.from(workPolicy)
				.where(eq(workPolicy.organizationId, organizationId)),
			db.select({ count: count() }).from(holiday).where(eq(holiday.organizationId, organizationId)),
			db
				.select({ count: count() })
				.from(surchargeModel)
				.where(eq(surchargeModel.organizationId, organizationId)),
		]);

		return {
			success: true,
			data: {
				employees: employeeCount[0].count,
				teams: teamCount[0].count,
				workCategories: workCategoryCount[0].count,
				workPeriods: workPeriodCount[0].count,
				absences: absenceCount[0].count,
				workPolicies: workPolicyCount[0].count,
				holidays: holidayCount[0].count,
				surcharges: surchargeCount[0].count,
			},
		};
	} catch {
		return { success: false, error: "Failed to fetch data counts" };
	}
}
