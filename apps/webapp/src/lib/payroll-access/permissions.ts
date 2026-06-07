import { and, eq, inArray } from "drizzle-orm";
import {
	employee,
	payrollAccessEmployee,
	payrollAccessGrant,
	payrollAccessTeam,
	teamMembership,
} from "@/db/schema";

export interface PayrollAccessGrantRow {
	id: string;
	organizationId: string;
	payrollEmployeeId: string;
	scope: "all" | "specific";
	isActive: boolean;
}

export interface PayrollAccessEmployeeRow {
	employeeId: string;
	organizationId: string;
	isActive: boolean;
}

export interface PayrollAccessTeamMemberRow {
	employeeId: string;
	organizationId: string;
	isActive: boolean;
}

export function canManagePayrollAccess(input: {
	role: "admin" | "manager" | "employee" | null;
}): boolean {
	return input.role === "admin";
}

export function resolvePayrollAccessibleEmployeeIdsFromRows(input: {
	grant: PayrollAccessGrantRow | null;
	directRows: PayrollAccessEmployeeRow[];
	teamRows: PayrollAccessTeamMemberRow[];
	allEmployeeRows?: PayrollAccessEmployeeRow[];
}): string[] {
	if (!input.grant?.isActive) {
		return [];
	}

	const accessibleEmployeeIds = new Set<string>();
	const rows =
		input.grant.scope === "all"
			? (input.allEmployeeRows ?? [])
			: [...input.directRows, ...input.teamRows];

	for (const row of rows) {
		if (row.isActive && row.organizationId === input.grant.organizationId) {
			accessibleEmployeeIds.add(row.employeeId);
		}
	}

	return Array.from(accessibleEmployeeIds).toSorted();
}

export function intersectPayrollScope(input: {
	allowedEmployeeIds: string[];
	requestedEmployeeIds?: string[];
}): string[] {
	const allowedEmployeeIds = new Set(input.allowedEmployeeIds);

	if (!input.requestedEmployeeIds) {
		return Array.from(allowedEmployeeIds).toSorted();
	}

	return input.requestedEmployeeIds
		.filter((employeeId) => allowedEmployeeIds.has(employeeId))
		.sort();
}

export async function hasActivePayrollAccessGrant(input: {
	organizationId: string;
	payrollEmployeeId: string;
}): Promise<boolean> {
	const { db } = await import("@/db");
	const [grant] = await db
		.select({ id: payrollAccessGrant.id })
		.from(payrollAccessGrant)
		.where(
			and(
				eq(payrollAccessGrant.organizationId, input.organizationId),
				eq(payrollAccessGrant.payrollEmployeeId, input.payrollEmployeeId),
				eq(payrollAccessGrant.isActive, true),
			),
		)
		.limit(1);

	return Boolean(grant);
}

export async function resolvePayrollAccessibleEmployeeIds(input: {
	organizationId: string;
	payrollEmployeeId: string;
}): Promise<string[]> {
	const { db } = await import("@/db");
	const [grant] = await db
		.select({
			id: payrollAccessGrant.id,
			organizationId: payrollAccessGrant.organizationId,
			payrollEmployeeId: payrollAccessGrant.payrollEmployeeId,
			scope: payrollAccessGrant.scope,
			isActive: payrollAccessGrant.isActive,
		})
		.from(payrollAccessGrant)
		.where(
			and(
				eq(payrollAccessGrant.organizationId, input.organizationId),
				eq(payrollAccessGrant.payrollEmployeeId, input.payrollEmployeeId),
				eq(payrollAccessGrant.isActive, true),
			),
		)
		.limit(1);

	if (!grant) {
		return [];
	}
	const normalizedGrant: PayrollAccessGrantRow = {
		...grant,
		scope: grant.scope === "all" ? "all" : "specific",
	};

	if (normalizedGrant.scope === "all") {
		const allEmployeeRows = await db
			.select({
				employeeId: employee.id,
				organizationId: employee.organizationId,
				isActive: employee.isActive,
			})
			.from(employee)
			.where(eq(employee.organizationId, input.organizationId));

		return resolvePayrollAccessibleEmployeeIdsFromRows({
			grant: normalizedGrant,
			directRows: [],
			teamRows: [],
			allEmployeeRows,
		});
	}

	const directRows = await db
		.select({
			employeeId: employee.id,
			organizationId: employee.organizationId,
			isActive: employee.isActive,
		})
		.from(payrollAccessEmployee)
		.innerJoin(employee, eq(payrollAccessEmployee.employeeId, employee.id))
		.where(
			and(
				eq(payrollAccessEmployee.organizationId, input.organizationId),
				eq(payrollAccessEmployee.grantId, grant.id),
				eq(employee.organizationId, input.organizationId),
			),
		);

	const assignedTeamRows = await db
		.select({ teamId: payrollAccessTeam.teamId })
		.from(payrollAccessTeam)
		.where(
			and(
				eq(payrollAccessTeam.organizationId, input.organizationId),
				eq(payrollAccessTeam.grantId, grant.id),
			),
		);

	const assignedTeamIds = assignedTeamRows.map((row) => row.teamId);
	if (assignedTeamIds.length === 0) {
		return resolvePayrollAccessibleEmployeeIdsFromRows({
			grant: normalizedGrant,
			directRows,
			teamRows: [],
		});
	}

	const [employeeTeamRows, teamMembershipRows] = await Promise.all([
		db
			.select({
				employeeId: employee.id,
				organizationId: employee.organizationId,
				isActive: employee.isActive,
			})
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, input.organizationId),
					inArray(employee.teamId, assignedTeamIds),
				),
			),
		db
			.select({
				employeeId: employee.id,
				organizationId: employee.organizationId,
				isActive: employee.isActive,
			})
			.from(teamMembership)
			.innerJoin(employee, eq(teamMembership.employeeId, employee.id))
			.where(
				and(
					eq(teamMembership.organizationId, input.organizationId),
					inArray(teamMembership.teamId, assignedTeamIds),
					eq(employee.organizationId, input.organizationId),
				),
			),
	]);

	return resolvePayrollAccessibleEmployeeIdsFromRows({
		grant: normalizedGrant,
		directRows,
		teamRows: [...employeeTeamRows, ...teamMembershipRows],
	});
}
