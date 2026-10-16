"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { logger } from "@/lib/logger";
import {
	listDrivingLicenceVerifierEmployees,
	resolveDrivingLicenceAccess,
	resolveDrivingLicenceEmployeeAccess,
} from "./access";
import {
	requireDrivingLicenceActor,
	requireDrivingLicenceAdministrator,
} from "./context";
import {
	type DrivingLicenceVerifierGrantRecord,
	listDrivingLicenceVerifierGrants,
	revokeDrivingLicenceVerifierGrant,
	type SaveDrivingLicenceVerifierGrantInput,
	saveDrivingLicenceVerifierGrant,
} from "./verifiers";

export interface DrivingLicenceVerifierResponsibility
	extends DrivingLicenceVerifierGrantRecord {
	teams: Array<{ id: string; name: string }>;
	employees: Array<{ id: string; name: string }>;
}
type Result<T> = { success: true; data: T } | { success: false; error: string };
export interface DrivingLicenceVerifierAdminData {
	employees: Array<{ id: string; name: string; email: string }>;
	teams: Array<{ id: string; name: string }>;
	grants: DrivingLicenceVerifierGrantRecord[];
}
function failure(error: unknown): { success: false; error: string } {
	logger.error({ error }, "Driving licence verifier action failed");
	return {
		success: false,
		error:
			"Could not update or access driving licence verifier responsibility. Check your permissions and selections.",
	};
}
export async function getDrivingLicenceVerifierAdminDataAction(): Promise<
	Result<DrivingLicenceVerifierAdminData>
> {
	try {
		const actor = await requireDrivingLicenceAdministrator();
		const [employees, teams, grants] = await Promise.all([
			db
				.select({ id: employee.id, name: user.name, email: user.email })
				.from(employee)
				.innerJoin(user, eq(user.id, employee.userId))
				.where(
					and(
						eq(employee.organizationId, actor.organizationId),
						employeeHasOrganizationAccess(),
					),
				)
				.orderBy(user.name),
			db
				.select({ id: team.id, name: team.name })
				.from(team)
				.where(eq(team.organizationId, actor.organizationId))
				.orderBy(team.name),
			listDrivingLicenceVerifierGrants(db, actor.organizationId),
		]);
		return { success: true, data: { employees, teams, grants } };
	} catch (error) {
		return failure(error);
	}
}
export async function saveDrivingLicenceVerifierGrantAction(
	input: SaveDrivingLicenceVerifierGrantInput,
): Promise<Result<{ grantId: string }>> {
	try {
		const actor = await requireDrivingLicenceAdministrator();
		const grantId = await db.transaction((tx) =>
			saveDrivingLicenceVerifierGrant(tx, {
				organizationId: actor.organizationId,
				actorUserId: actor.userId,
				grant: input,
			}),
		);
		revalidatePath("/settings/driving-licence");
		return { success: true, data: { grantId } };
	} catch (error) {
		return failure(error);
	}
}
export async function revokeDrivingLicenceVerifierGrantAction(input: {
	grantId: string;
}): Promise<Result<{ grantId: string }>> {
	try {
		const actor = await requireDrivingLicenceAdministrator();
		const grantId = await db.transaction((tx) =>
			revokeDrivingLicenceVerifierGrant(tx, {
				organizationId: actor.organizationId,
				actorUserId: actor.userId,
				grantId: input?.grantId,
			}),
		);
		revalidatePath("/settings/driving-licence");
		return { success: true, data: { grantId } };
	} catch (error) {
		return failure(error);
	}
}
export async function getDrivingLicenceVerifierResponsibilityAction(): Promise<
	Result<DrivingLicenceVerifierResponsibility | null>
> {
	try {
		const actor = await requireDrivingLicenceActor();
		const access = await resolveDrivingLicenceAccess(db, actor);
		if (!access?.grant) return { success: true, data: null };
		const grant = access.grant;
		const [teams, employees] = await Promise.all([
			grant.teamIds.length
				? db
						.select({ id: team.id, name: team.name })
						.from(team)
						.where(
							and(
								eq(team.organizationId, actor.organizationId),
								inArray(team.id, grant.teamIds),
							),
						)
						.orderBy(team.name)
				: [],
			grant.employeeIds.length
				? db
						.select({ id: employee.id, name: user.name })
						.from(employee)
						.innerJoin(user, eq(user.id, employee.userId))
						.where(
							and(
								eq(employee.organizationId, actor.organizationId),
								inArray(employee.id, grant.employeeIds),
							),
						)
						.orderBy(user.name)
				: [],
		]);
		return { success: true, data: { ...grant, teams, employees } };
	} catch (error) {
		return failure(error);
	}
}
export async function getDrivingLicenceEmployeeAccessAction(input: {
	employeeId: string;
}): Promise<Result<{ canRead: boolean; canVerify: boolean }>> {
	try {
		const actor = await requireDrivingLicenceActor();
		const employeeId = z.uuid().parse(input.employeeId);
		return {
			success: true,
			data: await resolveDrivingLicenceEmployeeAccess(db, {
				...actor,
				employeeId,
			}),
		};
	} catch (error) {
		return failure(error);
	}
}
export async function listDrivingLicenceVerifierEmployeesAction(): Promise<
	Result<Array<{ id: string; canVerify: boolean }>>
> {
	try {
		const actor = await requireDrivingLicenceActor();
		return {
			success: true,
			data: await listDrivingLicenceVerifierEmployees(db, actor),
		};
	} catch (error) {
		return failure(error);
	}
}
