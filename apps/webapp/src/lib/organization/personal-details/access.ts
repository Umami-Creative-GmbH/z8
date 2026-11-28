import { and, eq } from "drizzle-orm";
import { employee } from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import { findCoveringPayrollAccessGrant } from "@/lib/payroll-access/adjustment-coverage";
import {
	loadSettingsAccessFacts,
	settingsAccessOf,
} from "@/lib/organization-action/settings-access";
import { isUuid } from "@/lib/validations/uuid";

/**
 * A viewer's right to one employee's personal details in one organization:
 * `own` for the employee themselves (see in full, change only by request),
 * `decider` for those who may decide their personal details change requests
 * (see masked until revealed, change and end directly), else none.
 */
export type PersonalDetailsRight =
	| { kind: "none" }
	| { kind: "own"; employeeUserId: string }
	| { kind: "decider"; employeeUserId: string };

type Reader = Pick<DatabaseClient, "select" | "execute">;

/**
 * The one rule of who may see and decide an employee's personal details
 * (Organization glossary, "Personal details change request"; spec #2068).
 *
 * - The employee sees their own, and never decides their own: a decider viewing
 *   their own details gets `own` too.
 * - Org admins (owners included) decide for every employee of the organization.
 * - Holders of an active payroll access grant covering the employee decide too
 *   (#2071): scope `all`, or the employee named or in a named team, the same
 *   coverage balance adjustments use (`findCoveringPayrollAccessGrant`), so a
 *   covered employee who has left stays covered.
 * - Managing the employee, workforce admin and personnel file officer give no right.
 * - A former employee, or a user without an approved membership, has no right.
 */
export async function resolvePersonalDetailsRight(
	db: Reader,
	input: { organizationId: string; actorUserId: string; employeeId: string },
): Promise<PersonalDetailsRight> {
	if (!isUuid(input.employeeId)) return { kind: "none" };
	const [target] = await db
		.select({ id: employee.id, userId: employee.userId })
		.from(employee)
		.where(
			and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		)
		.limit(1);
	if (!target) return { kind: "none" };
	const facts = await loadSettingsAccessFacts(db, {
		userId: input.actorUserId,
		organizationId: input.organizationId,
	});
	const access = settingsAccessOf(facts);
	if (access === null) return { kind: "none" };
	if (facts.employee?.id === target.id) return { kind: "own", employeeUserId: target.userId };
	if (meetsSettingsAccess(access, "orgAdmin")) {
		return { kind: "decider", employeeUserId: target.userId };
	}
	const grant = await findCoveringPayrollAccessGrant(db, {
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		employeeId: target.id,
	});
	if (grant) return { kind: "decider", employeeUserId: target.userId };
	return { kind: "none" };
}
