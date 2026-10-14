/**
 * What the README's Art. 15 sections say about one employee (#811, #1172):
 * who in the organization can access their data, and how long it is kept.
 *
 * Read from the organization's configuration and grants only, never from the
 * employee's own records (apart from their teams and approved expense
 * reports, which decide officer coverage), so the README cannot reveal
 * whether withheld data exists. Everyone listed has organization access now
 * (approved member, active and not past a departure cutoff); the employee
 * themselves is never listed.
 *
 * - Owners and admins: approved members with the `owner` or `admin` role.
 * - Managers: direct managers (`employee_managers`) plus holders of team
 *   permissions that cover one of the employee's current teams (or the whole
 *   organization), except a permission to create teams only.
 * - Personnel file officers: from the personnel file access resolver, with
 *   the categories they manage in this employee's file; none while personnel
 *   files are turned off.
 * - Payroll access: grants covering the employee by scope, named employee or
 *   current team, with what each covers. Unlike the payroll resolver, a
 *   former employee stays covered (#811 decision), so their README still
 *   lists who has access.
 * - Expense officers: grants covering the employee by scope, named employee,
 *   current team or a team recorded at the approval of one of their reports
 *   or legacy claims.
 *
 * An officer holds at most one active payroll grant and one active expense
 * grant (partial unique indexes), so each is listed once.
 */

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { member, user } from "@/db/auth-schema";
import {
	employee,
	employeeManagers,
	expenseOfficerEmployee,
	expenseOfficerGrant,
	expenseOfficerTeam,
	payrollAccessEmployee,
	payrollAccessGrant,
	payrollAccessTeam,
	teamPermissions,
	travelExpenseClaim,
	travelExpenseReport,
} from "@/db/schema";
import { AUDIT_LOG_RETENTION_DAYS } from "@/lib/audit/retention";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { managedCategoriesFor } from "@/lib/personnel-file/access";
import { loadEmployeeRef, resolvePersonnelFileAccess } from "@/lib/personnel-file/access-store";
import { DOCUMENT_CATEGORIES } from "@/lib/personnel-file/document.types";
import { listActivePersonnelFileOfficers } from "@/lib/personnel-file/officer-grant-store";
import { loadRetentionPeriods } from "@/lib/personnel-file/retention-store";
import type { PersonalDataExportDatabase } from "./collector";
import type {
	PayrollCoverage,
	PersonalDataReadmeAccess,
	PersonalDataReadmeRetention,
} from "./readme";
import { loadEmployeeNames } from "./values";

export interface PersonalDataReadmeFacts {
	access: PersonalDataReadmeAccess;
	retention: PersonalDataReadmeRetention;
}

interface Person {
	employeeId: string | null;
	userId: string;
	name: string;
}

const byName = <T extends { name: string }>(rows: T[]) =>
	rows.toSorted((left, right) => left.name.localeCompare(right.name));

export async function loadPersonalDataReadmeFacts(
	database: PersonalDataExportDatabase,
	input: { organizationId: string; employeeId: string; now?: Instant },
): Promise<PersonalDataReadmeFacts> {
	const { organizationId, employeeId, now } = input;
	const subject = await loadEmployeeRef(database, {
		organizationId,
		employeeId,
	});
	if (!subject) throw new Error("The export's employee no longer exists in its organization");
	const teamIds = [...subject.teamIds];

	/** Employees of the organization with access now, with their names; never the subject. */
	const people = async (employeeIds: Iterable<string>): Promise<Map<string, Person>> => {
		const ids = [...new Set(employeeIds)].filter((id) => id !== employeeId);
		if (ids.length === 0) return new Map();
		const rows = await database
			.select({
				id: employee.id,
				userId: employee.userId,
				name: user.name,
				firstName: user.firstName,
				lastName: user.lastName,
				email: user.email,
			})
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.innerJoin(
				member,
				and(
					eq(member.userId, employee.userId),
					eq(member.organizationId, organizationId),
					eq(member.status, "approved"),
				),
			)
			.where(
				and(
					eq(employee.organizationId, organizationId),
					inArray(employee.id, ids),
					employeeHasOrganizationAccess(now),
				),
			);
		return new Map(
			rows.map((row) => [
				row.id,
				{
					employeeId: row.id,
					userId: row.userId,
					name: buildAuthUserDisplayName(row),
				},
			]),
		);
	};

	const [
		ownersAndAdmins,
		managers,
		personnelFileOfficers,
		payrollOfficers,
		expenseOfficers,
		documentYears,
	] = await Promise.all([
		loadOwnersAndAdmins(database, { organizationId, employeeId, now }),
		loadManagers(database, { organizationId, employeeId, teamIds, people }),
		loadPersonnelFileOfficers(database, { organizationId, subject, now }),
		loadPayrollOfficers(database, {
			organizationId,
			employeeId,
			teamIds,
			people,
		}),
		loadExpenseOfficers(database, {
			organizationId,
			employeeId,
			teamIds,
			people,
		}),
		loadRetentionPeriods(database, organizationId),
	]);
	return {
		access: {
			ownersAndAdmins,
			managers,
			personnelFileOfficers,
			payrollOfficers,
			expenseOfficers,
		},
		retention: { documentYears, auditLogDays: AUDIT_LOG_RETENTION_DAYS },
	};
}

async function loadOwnersAndAdmins(
	database: PersonalDataExportDatabase,
	input: { organizationId: string; employeeId: string; now?: Instant },
): Promise<PersonalDataReadmeAccess["ownersAndAdmins"]> {
	const rows = await database
		.select({
			role: member.role,
			employeeId: employee.id,
			hasAccess: employeeHasOrganizationAccess(input.now),
			name: user.name,
			firstName: user.firstName,
			lastName: user.lastName,
			email: user.email,
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.leftJoin(
			employee,
			and(eq(employee.userId, member.userId), eq(employee.organizationId, input.organizationId)),
		)
		.where(and(eq(member.organizationId, input.organizationId), eq(member.status, "approved")));
	return byName(
		rows.flatMap((row) => {
			// A member without an employee record keeps access; one whose employment ended does not.
			if (row.employeeId === input.employeeId) return [];
			if (row.employeeId && !row.hasAccess) return [];
			const role = hasOrganizationRole(row.role, "owner")
				? ("owner" as const)
				: hasOrganizationRole(row.role, "admin")
					? ("admin" as const)
					: null;
			return role ? [{ name: buildAuthUserDisplayName(row), role }] : [];
		}),
	);
}

type People = (employeeIds: Iterable<string>) => Promise<Map<string, Person>>;

async function loadManagers(
	database: PersonalDataExportDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		teamIds: string[];
		people: People;
	},
): Promise<PersonalDataReadmeAccess["managers"]> {
	const { organizationId, teamIds } = input;
	const [direct, permitted] = await Promise.all([
		// `employee_managers` has no organization; `people` keeps only this one's employees.
		database
			.select({ managerId: employeeManagers.managerId })
			.from(employeeManagers)
			.where(eq(employeeManagers.employeeId, input.employeeId)),
		database
			.select({ employeeId: teamPermissions.employeeId })
			.from(teamPermissions)
			.where(
				and(
					eq(teamPermissions.organizationId, organizationId),
					or(
						isNull(teamPermissions.teamId),
						teamIds.length > 0 ? inArray(teamPermissions.teamId, teamIds) : undefined,
					),
					or(
						eq(teamPermissions.canManageTeamMembers, true),
						eq(teamPermissions.canManageTeamSettings, true),
						eq(teamPermissions.canApproveTeamRequests, true),
					),
				),
			),
	]);
	const directIds = new Set(direct.map((row) => row.managerId));
	const found = await input.people([...directIds, ...permitted.map((row) => row.employeeId)]);
	return byName(
		[...found.values()].map((person) => ({
			name: person.name,
			via: directIds.has(person.employeeId ?? "") ? ("direct" as const) : ("team" as const),
		})),
	);
}

async function loadPersonnelFileOfficers(
	database: PersonalDataExportDatabase,
	input: {
		organizationId: string;
		subject: { id: string; teamIds: readonly string[] };
		now?: Instant;
	},
): Promise<PersonalDataReadmeAccess["personnelFileOfficers"]> {
	const { organizationId, subject } = input;
	const officers = await listActivePersonnelFileOfficers(database, {
		organizationId,
	});
	const candidates = officers.filter((officer) => officer.grant.officerEmployeeId !== subject.id);
	if (candidates.length === 0) return [];
	// The resolver applies the toggle, membership, departure cutoff and own-file rule.
	const resolved = await Promise.all(
		candidates.map(async (officer) => {
			const access = await resolvePersonnelFileAccess(database, {
				userId: officer.userId,
				organizationId,
				now: input.now,
			});
			if (!access) return null;
			const managed = managedCategoriesFor(
				{
					...access,
					grants: access.grants.filter((grant) => grant.source === "officer_grant"),
				},
				subject,
			);
			const categories = DOCUMENT_CATEGORIES.filter((category) => managed.has(category));
			return categories.length > 0
				? { employeeId: officer.grant.officerEmployeeId, categories }
				: null;
		}),
	);
	const covering = resolved.filter((entry) => entry !== null);
	const names = await loadEmployeeNames(
		database,
		organizationId,
		covering.map((entry) => entry.employeeId),
	);
	return byName(
		covering.flatMap((entry) => {
			const name = names.get(entry.employeeId);
			return name ? [{ name, categories: entry.categories }] : [];
		}),
	);
}

async function loadPayrollOfficers(
	database: PersonalDataExportDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		teamIds: string[];
		people: People;
	},
): Promise<PersonalDataReadmeAccess["payrollOfficers"]> {
	const { organizationId, employeeId, teamIds } = input;
	const [grants, named, teams] = await Promise.all([
		database
			.select({
				id: payrollAccessGrant.id,
				officerId: payrollAccessGrant.payrollEmployeeId,
				scope: payrollAccessGrant.scope,
			})
			.from(payrollAccessGrant)
			.where(
				and(
					eq(payrollAccessGrant.organizationId, organizationId),
					eq(payrollAccessGrant.isActive, true),
				),
			),
		database
			.select({ grantId: payrollAccessEmployee.grantId })
			.from(payrollAccessEmployee)
			.where(
				and(
					eq(payrollAccessEmployee.organizationId, organizationId),
					eq(payrollAccessEmployee.employeeId, employeeId),
				),
			),
		teamIds.length === 0
			? Promise.resolve([])
			: database
					.select({ grantId: payrollAccessTeam.grantId })
					.from(payrollAccessTeam)
					.where(
						and(
							eq(payrollAccessTeam.organizationId, organizationId),
							inArray(payrollAccessTeam.teamId, teamIds),
						),
					),
	]);
	const namedGrantIds = new Set(named.map((row) => row.grantId));
	const teamGrantIds = new Set(teams.map((row) => row.grantId));
	// What each covering grant covers, in a fixed order (one active grant per officer).
	const coverage = new Map<string, PayrollCoverage[]>();
	for (const grant of grants) {
		const covers: PayrollCoverage[] = [
			...(grant.scope === "all" ? (["all"] as const) : []),
			...(namedGrantIds.has(grant.id) ? (["employee"] as const) : []),
			...(teamGrantIds.has(grant.id) ? (["team"] as const) : []),
		];
		if (covers.length === 0) continue;
		const known = coverage.get(grant.officerId) ?? [];
		coverage.set(grant.officerId, [...new Set([...known, ...covers])]);
	}
	const found = await input.people(coverage.keys());
	return byName(
		[...found.values()].map((person) => ({
			name: person.name,
			covers: coverage.get(person.employeeId ?? "") ?? [],
		})),
	);
}

async function loadExpenseOfficers(
	database: PersonalDataExportDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		teamIds: string[];
		people: People;
	},
): Promise<PersonalDataReadmeAccess["expenseOfficers"]> {
	const { organizationId, employeeId } = input;
	const [grants, named, reports, claims] = await Promise.all([
		database
			.select({
				id: expenseOfficerGrant.id,
				officerId: expenseOfficerGrant.officerEmployeeId,
				scope: expenseOfficerGrant.scope,
				canExport: expenseOfficerGrant.canExport,
				canRecordReimbursements: expenseOfficerGrant.canRecordReimbursements,
			})
			.from(expenseOfficerGrant)
			.where(
				and(
					eq(expenseOfficerGrant.organizationId, organizationId),
					eq(expenseOfficerGrant.isActive, true),
				),
			),
		database
			.select({ grantId: expenseOfficerEmployee.grantId })
			.from(expenseOfficerEmployee)
			.where(
				and(
					eq(expenseOfficerEmployee.organizationId, organizationId),
					eq(expenseOfficerEmployee.employeeId, employeeId),
				),
			),
		database
			.select({ teamIds: travelExpenseReport.approvalTeamIds })
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.organizationId, organizationId),
					eq(travelExpenseReport.employeeId, employeeId),
				),
			),
		database
			.select({ teamIds: travelExpenseClaim.approvalTeamIds })
			.from(travelExpenseClaim)
			.where(
				and(
					eq(travelExpenseClaim.organizationId, organizationId),
					eq(travelExpenseClaim.employeeId, employeeId),
				),
			),
	]);
	// The employee's current teams cover future reports; recorded teams cover approved ones.
	const teamIds = [
		...new Set([...input.teamIds, ...[...reports, ...claims].flatMap((row) => row.teamIds ?? [])]),
	];
	const teams =
		teamIds.length === 0
			? []
			: await database
					.select({ grantId: expenseOfficerTeam.grantId })
					.from(expenseOfficerTeam)
					.where(
						and(
							eq(expenseOfficerTeam.organizationId, organizationId),
							inArray(expenseOfficerTeam.teamId, teamIds),
						),
					);
	const coveringGrantIds = new Set([...named, ...teams].map((row) => row.grantId));
	const covering = grants.filter(
		(grant) => grant.scope === "all" || coveringGrantIds.has(grant.id),
	);
	const found = await input.people(covering.map((grant) => grant.officerId));
	return byName(
		covering.flatMap((grant) => {
			const person = found.get(grant.officerId);
			return person
				? [
						{
							name: person.name,
							canExport: grant.canExport,
							canRecordReimbursements: grant.canRecordReimbursements,
						},
					]
				: [];
		}),
	);
}
