"use server";

import { and, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { ClockinClient } from "@/lib/clockin/client";
import { orchestrateClockinImport } from "@/lib/clockin/import-orchestrator";
import type {
	ClockinImportResult,
	ClockinImportSelections,
	ClockinImportUserMapping,
} from "@/lib/clockin/import-types";

type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export interface ClockinPreview {
	employees: number;
	workdays: number;
	absences: number;
	schedules: number;
}

export interface ClockinEmployeeInfo {
	id: number;
	name: string;
	email: string | null;
}

export interface Z8EmployeeInfo {
	id: string;
	userId: string;
	name: string;
	email: string;
}

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

async function validateEmployeeOwnership(
	employeeIds: string[],
	organizationId: string,
): Promise<void> {
	if (employeeIds.length === 0) return;

	const validEmployees = await db
		.select({ id: employee.id })
		.from(employee)
		.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, employeeIds)));

	const validIds = new Set(validEmployees.map((entry) => entry.id));
	const invalidIds = employeeIds.filter((id) => !validIds.has(id));
	if (invalidIds.length > 0) {
		throw new Error("One or more employee IDs do not belong to this organization");
	}
}

export async function validateClockinCredentials(
	token: string,
	organizationId: string,
): Promise<ActionResult<ClockinPreview>> {
	try {
		await requireAdmin(organizationId);

		if (!token.trim()) {
			return { success: false, error: "API token is required" };
		}

		const client = new ClockinClient(token.trim());
		const connection = await client.testConnection();
		if (!connection.success) {
			return { success: false, error: connection.error };
		}

		const startDate = DateTime.utc().startOf("year").toISODate();
		const endDate = DateTime.utc().endOf("day").toISODate();
		if (!startDate || !endDate) {
			return { success: false, error: "Failed to build preview date range" };
		}

		const employees = await client.getEmployees();
		const employeeIds = employees.map((entry) => entry.id);
		const [workdays, absences] = await Promise.all([
			employeeIds.length > 0
				? client.searchWorkdays({ employeeIds, startDate, endDate })
				: Promise.resolve([]),
			employeeIds.length > 0
				? client.searchAbsences({ employeeIds, startDate, endDate })
				: Promise.resolve([]),
		]);

		return {
			success: true,
			data: {
				employees: employees.length,
				workdays: workdays.length,
				absences: absences.length,
				schedules: 0,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to validate Clockin credentials",
		};
	}
}

export async function fetchClockinEmployees(
	token: string,
	organizationId: string,
): Promise<ActionResult<ClockinEmployeeInfo[]>> {
	try {
		await requireAdmin(organizationId);

		if (!token.trim()) {
			return { success: false, error: "API token is required" };
		}

		const client = new ClockinClient(token.trim());
		const employees = await client.getEmployees();

		return {
			success: true,
			data: employees.map((entry) => ({
				id: entry.id,
				name: `${entry.first_name} ${entry.last_name}`.trim(),
				email: entry.email,
			})),
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to fetch Clockin employees",
		};
	}
}

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
			data: employees.map((entry) => ({
				id: entry.id,
				userId: entry.userId,
				name:
					entry.firstName && entry.lastName
						? `${entry.firstName} ${entry.lastName}`
						: (entry.userName ?? entry.email),
				email: entry.email,
			})),
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to fetch employees",
		};
	}
}

export async function importClockinData(
	token: string,
	organizationId: string,
	selections: ClockinImportSelections,
	mappings: ClockinImportUserMapping[],
): Promise<ActionResult<ClockinImportResult>> {
	try {
		const authContext = await requireAdmin(organizationId);

		if (!token.trim()) {
			return { success: false, error: "API token is required" };
		}

		await validateEmployeeOwnership(
			mappings.map((entry) => entry.employeeId).filter((entry): entry is string => entry != null),
			organizationId,
		);

		const client = new ClockinClient(token.trim());
		const connection = await client.testConnection();
		if (!connection.success) {
			return { success: false, error: connection.error };
		}

		const result = await orchestrateClockinImport(
			client,
			organizationId,
			authContext.user.id,
			selections,
			mappings,
		);

		return { success: true, data: result };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Failed to import Clockin data",
		};
	}
}
