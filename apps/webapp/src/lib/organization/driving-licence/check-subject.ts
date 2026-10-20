import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { drivingLicenceVerifierEmployeeCondition, resolveDrivingLicenceAccess } from "./access";
import type { DrivingLicenceDatabase } from "./verifiers";

export interface DrivingLicenceCheckSubject {
	employeeId: string;
	name: string;
	/** False for a former employee: the evidence stays readable, no new check is offered. */
	canVerify: boolean;
}

/**
 * The employee a check page is about (#1429), or null unless the viewer's current verifier
 * grant covers that employee in this organization. A verifier never gets their own check.
 * Uses the same grant scope as the Checks table and the check command.
 */
export async function readDrivingLicenceCheckSubject(
	input: { organizationId: string; userId: string; employeeId: string; now?: Instant },
	database: DrivingLicenceDatabase = db,
): Promise<DrivingLicenceCheckSubject | null> {
	const now = input.now ?? systemClock.nowInstant();
	const access = await resolveDrivingLicenceAccess(database, { ...input, now });
	if (!access?.grant || access.selfEmployeeId === input.employeeId) return null;
	const [target] = await database
		.select({
			employeeId: employee.id,
			name: user.name,
			canVerify: employeeHasOrganizationAccess(now),
		})
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.id, input.employeeId), drivingLicenceVerifierEmployeeCondition(access)))
		.limit(1);
	return target ? { ...target, name: target.name ?? target.employeeId } : null;
}
