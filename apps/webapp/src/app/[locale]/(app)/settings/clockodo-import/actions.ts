"use server";

import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import {
	absenceEntry,
	clockodoUserMapping,
	employee,
	holiday,
	surchargeModel,
	team,
	workCategory,
	workPeriod,
	workPolicy,
} from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { ClockodoClient } from "@/lib/clockodo/client";
import type { ImportUserMapping } from "@/lib/clockodo/import-orchestrator";
import { orchestrateImport } from "@/lib/clockodo/import-orchestrator";
import type {
	ClockodoDataPreview,
	ImportResult,
	ImportSelections,
	UserMappingEntry,
} from "@/lib/clockodo/types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ClockodoImportActions");

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
	const memberRecord = await db.query.member.findFirst({
		where: and(
			eq(authSchema.member.userId, authContext.user.id),
			eq(authSchema.member.organizationId, organizationId),
		),
	});

	if (!memberRecord || (memberRecord.role !== "owner" && memberRecord.role !== "admin")) {
		throw new Error("Unauthorized");
	}

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
		await requireAdmin(organizationId);

		if (!email?.trim() || !apiKey?.trim()) {
			return { success: false, error: "Email and API key are required" };
		}

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
				firstName: employee.firstName,
				lastName: employee.lastName,
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
				name: e.firstName && e.lastName ? `${e.firstName} ${e.lastName}` : (e.userName ?? e.email),
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
		const employeeIds = mappings
			.map((m) => m.employeeId)
			.filter((id): id is string => id != null);
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
// RUN IMPORT
// ============================================

export async function importClockodoData(
	email: string,
	apiKey: string,
	organizationId: string,
	selections: ImportSelections,
	serializedMappings?: ImportUserMapping[],
	onlyImportMapped?: boolean,
): Promise<ActionResult<ImportResult>> {
	try {
		const authContext = await requireAdmin(organizationId);

		if (!email?.trim() || !apiKey?.trim()) {
			return { success: false, error: "Email and API key are required" };
		}

		const client = new ClockodoClient(email.trim(), apiKey.trim());

		// Verify connection before starting import
		const connected = await client.testConnection();
		if (!connected) {
			return { success: false, error: "Invalid credentials" };
		}

		// Validate that all employee IDs in mappings belong to this organization
		if (serializedMappings) {
			const employeeIds = serializedMappings
				.map((m) => m.employeeId)
				.filter((id): id is string => id != null);
			await validateEmployeeOwnership(employeeIds, organizationId);
		}

		logger.info(
			{ organizationId, selections, userId: authContext.user.id },
			"Starting Clockodo import",
		);

		const result = await orchestrateImport(
			client,
			organizationId,
			authContext.user.id,
			selections,
			serializedMappings,
			onlyImportMapped,
		);

		logger.info(
			{
				organizationId,
				status: result.status,
				durationMs: result.durationMs,
			},
			"Clockodo import completed",
		);

		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Clockodo import failed");
		return {
			success: false,
			error: error instanceof Error ? error.message : "Import failed",
		};
	}
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
