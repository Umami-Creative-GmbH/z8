"use server";

import { and, eq, inArray, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	formerSinceDate,
	isFormerEmployee,
	onCurrentRoster,
} from "@/lib/employee-lifecycle/current-roster";
import { FORMER_EMPLOYEE_REFUSAL } from "@/lib/employee-lifecycle/current-roster-guard";
import { ValidationError } from "@/lib/effect/errors";
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
	type DrivingLicenceVerifierGrantView,
	listDrivingLicenceVerifierGrants,
	readDrivingLicenceCalendarTimezone,
	revokeDrivingLicenceVerifierGrant,
	type SaveDrivingLicenceVerifierGrantInput,
	saveDrivingLicenceVerifierGrant,
	VERIFIER_UNTIL_IN_PAST,
	viewDrivingLicenceVerifierGrant,
} from "./verifiers";

export interface DrivingLicenceVerifierResponsibility
	extends DrivingLicenceVerifierGrantView {
	teams: Array<{ id: string; name: string }>;
	employees: Array<{ id: string; name: string }>;
	/** Calendar zone the until date is shown in. */
	timezone: string;
}
type Result<T> = { success: true; data: T } | { success: false; error: string };
export interface DrivingLicenceVerifierAdminData {
	/**
	 * The current roster, and former employees a live grant names (`isFormer`),
	 * with the organization-local date they left (`formerSince`, #1439; null for
	 * a current employee and when the date isn't recorded).
	 */
	employees: Array<{
		id: string;
		name: string;
		email: string;
		isFormer: boolean;
		formerSince: string | null;
	}>;
	teams: Array<{ id: string; name: string }>;
	grants: DrivingLicenceVerifierGrantView[];
	/** Calendar zone that until dates are entered and shown in. */
	timezone: string;
}
function failure(error: unknown): { success: false; error: string } {
	if (error instanceof ValidationError && error.refusal === FORMER_EMPLOYEE_REFUSAL)
		return { success: false, error: FORMER_EMPLOYEE_REFUSAL };
	if (
		error instanceof Error &&
		(error.message === VERIFIER_UNTIL_IN_PAST || error.message === "not_enabled")
	)
		return { success: false, error: error.message };
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
		const [teams, grants, timezone] = await Promise.all([
			db
				.select({ id: team.id, name: team.name })
				.from(team)
				.where(eq(team.organizationId, actor.organizationId))
				.orderBy(team.name),
			listDrivingLicenceVerifierGrants(db, actor.organizationId),
			readDrivingLicenceCalendarTimezone(db, actor.organizationId),
		]);
		// The current roster (#1438), plus former employees a live grant still
		// names, marked, so editing that grant keeps them instead of dropping them.
		const namedIds = [
			...new Set(
				grants.flatMap((grant) =>
					grant.revokedAt ? [] : [grant.verifierEmployeeId, ...grant.employeeIds],
				),
			),
		];
		const employees = await db
			.select({
				id: employee.id,
				name: user.name,
				email: user.email,
				isFormer: isFormerEmployee(employee),
				formerSince: formerSinceDate(employee),
			})
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(employee.organizationId, actor.organizationId),
					namedIds.length > 0
						? or(onCurrentRoster(actor.organizationId), inArray(employee.id, namedIds))
						: onCurrentRoster(actor.organizationId),
				),
			)
			.orderBy(user.name);
		const now = systemClock.nowInstant();
		return {
			success: true,
			data: {
				employees,
				teams,
				grants: grants.map((grant) =>
					viewDrivingLicenceVerifierGrant(grant, timezone, now),
				),
				timezone,
			},
		};
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
		const [teams, employees, timezone] = await Promise.all([
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
			readDrivingLicenceCalendarTimezone(db, actor.organizationId),
		]);
		return {
			success: true,
			data: {
				...viewDrivingLicenceVerifierGrant(
					grant,
					timezone,
					systemClock.nowInstant(),
				),
				teams,
				employees,
				timezone,
			},
		};
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
