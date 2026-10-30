import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db as rootDatabase } from "@/db";
import { employee, employeeManagers } from "@/db/schema";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";

/**
 * The people bot commands, manager digests and escalations work with, on the
 * organization's current roster only (#1438, Organization ADR 0006): a former
 * employee is neither counted nor listed, and a former manager receives no
 * digest and no escalated approval. Every read is organization-scoped.
 */
type Reader = Pick<typeof rootDatabase, "select">;

type ReportsInput = { organizationId: string; managerEmployeeId: string };
type DigestManagerInput = { organizationId: string; userId: string };
type DigestManager = { id: string };
type EmployeesInput = { organizationId: string; employeeIds: readonly string[] };
type RosterEmployee = { id: string; userId: string };

/** A manager's reports on the current roster: whom `/clockedin`, `/whosout` and the digest count and list. */
export async function currentRosterReportIds(
	client: Reader,
	input: ReportsInput,
): Promise<string[]> {
	const rows = await client
		.select({ employeeId: employee.id })
		.from(employeeManagers)
		.innerJoin(employee, eq(employee.id, employeeManagers.employeeId))
		.where(
			and(
				eq(employeeManagers.managerId, input.managerEmployeeId),
				onCurrentRoster(input.organizationId),
			),
		);
	return [...new Set(rows.map((row) => row.employeeId))].toSorted();
}

/**
 * The employee a manager digest goes to for this user: their employee in the
 * organization while they are on the current roster and manage at least one
 * report who is too. Null for anyone else.
 */
export async function currentRosterDigestManager(
	client: Reader,
	input: DigestManagerInput,
): Promise<DigestManager | null> {
	const report = alias(employee, "digest_report");
	const [manager] = await client
		.select({ id: employee.id })
		.from(employee)
		.innerJoin(employeeManagers, eq(employeeManagers.managerId, employee.id))
		.innerJoin(report, eq(report.id, employeeManagers.employeeId))
		.where(
			and(
				eq(employee.userId, input.userId),
				onCurrentRoster(input.organizationId),
				onCurrentRoster(input.organizationId, report),
			),
		)
		.limit(1);
	return manager ?? null;
}

/** Of these employees, those on the current roster with their users: who may receive an escalated approval. */
export async function currentRosterEmployees(
	client: Reader,
	input: EmployeesInput,
): Promise<RosterEmployee[]> {
	if (input.employeeIds.length === 0) return [];
	return client
		.select({ id: employee.id, userId: employee.userId })
		.from(employee)
		.where(
			and(inArray(employee.id, [...input.employeeIds]), onCurrentRoster(input.organizationId)),
		);
}
