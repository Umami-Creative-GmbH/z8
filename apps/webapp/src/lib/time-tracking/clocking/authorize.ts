import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { asAppSubject, defineAbilityFor } from "@/lib/authorization";
import { loadOrganizationPrincipalContext } from "@/lib/authorization/principal-loader";
import type { ClockCommand, ClockPrincipal, ClockSubject } from "./types";

type Employee = typeof employee.$inferSelect;

/** What authorization reads of a command: who asks, for whom, and which kind. */
export type AuthorizationQuery = {
	organizationId: string;
	principal: ClockPrincipal;
	subject: ClockSubject;
	/** Absent for a lookup, which answers self-service only. */
	kind?: ClockCommand["body"]["kind"];
};

/**
 * Whether the principal may create time entries for another employee: an owner
 * or admin for anyone active in the organization, a manager for a direct report.
 * Read or self-service access is never enough. The grant needs the principal's
 * own employee profile with organization access: a departed admin has none.
 */
async function mayActOnBehalf(principal: ClockPrincipal, subject: Employee) {
	const context = await loadOrganizationPrincipalContext(db, {
		userId: principal.userId,
		organizationId: subject.organizationId,
	});
	return defineAbilityFor(context).can(
		"create",
		asAppSubject("TimeEntry", {
			employeeId: subject.id,
			organizationId: subject.organizationId,
			teamId: subject.teamId,
		}),
	);
}

/**
 * The subject employee when the principal may run this command for them, else
 * null (#476 decision 5). Self-service runs every kind for one's own employee.
 * On behalf, only a clock-out runs, for another active employee, by an owner, an
 * admin or their direct manager; never for oneself. A departure runs only its
 * clock-out of the departing employee, whose access it has just ended; the module
 * checks that it runs inside that departure's transaction.
 */
export async function authorizedSubject(query: AuthorizationQuery): Promise<Employee | null> {
	const { principal, subject } = query;
	const [row] = await db
		.select()
		.from(employee)
		.where(
			and(eq(employee.id, subject.employeeId), eq(employee.organizationId, query.organizationId)),
		)
		.limit(1);
	if (!row) return null;
	if (principal.kind === "departure" || principal.kind === "automatic_clock_out") {
		return query.kind === "clock_out" && !subject.onBehalf ? row : null;
	}
	if (!subject.onBehalf) return row.userId === principal.userId ? row : null;
	if (query.kind !== "clock_out" || !row.isActive || row.userId === principal.userId) return null;
	return (await mayActOnBehalf(principal, row)) ? row : null;
}
