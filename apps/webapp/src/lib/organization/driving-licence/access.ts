import { and, eq, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import { member } from "@/db/auth-schema";
import { employee, teamMembership } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	type DrivingLicenceDatabase,
	type DrivingLicenceVerifierGrantRecord,
	loadDrivingLicenceVerifierGrant,
} from "./verifiers";

export interface DrivingLicenceAccess {
	organizationId: string;
	userId: string;
	selfEmployeeId: string | null;
	grant: DrivingLicenceVerifierGrantRecord | null;
}
/** All record, worklist, check and export callers resolve afresh; administrator/officer roles never supply a grant. */
export async function resolveDrivingLicenceAccess(
	database: DrivingLicenceDatabase,
	input: { organizationId: string; userId: string; now?: Instant },
): Promise<DrivingLicenceAccess | null> {
	const [membership] = await database
		.select({ id: member.id })
		.from(member)
		.where(
			and(
				eq(member.organizationId, input.organizationId),
				eq(member.userId, input.userId),
				eq(member.status, "approved"),
			),
		)
		.limit(1);
	const [profile] = await database
		.select({
			id: employee.id,
			hasAccess: employeeHasOrganizationAccess(input.now),
		})
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.userId, input.userId),
			),
		)
		.limit(1);
	if (!membership || (profile && !profile.hasAccess)) return null;
	return {
		organizationId: input.organizationId,
		userId: input.userId,
		selfEmployeeId: profile?.id ?? null,
		grant: profile
			? await loadDrivingLicenceVerifierGrant(database, {
					organizationId: input.organizationId,
					verifierEmployeeId: profile.id,
					now: input.now,
				})
			: null,
	};
}
/** Applies to employee rows only. Always couples scope with tenant and excludes self. */
export function drivingLicenceVerifierEmployeeCondition(
	access: DrivingLicenceAccess,
): SQL {
	if (!access.grant || !access.selfEmployeeId) return sql`false`;
	const grant = access.grant;
	const selections: SQL[] = [];
	if (grant.scope === "all") selections.push(sql`true`);
	if (grant.employeeIds.length)
		selections.push(inArray(employee.id, grant.employeeIds));
	if (grant.teamIds.length) {
		selections.push(inArray(employee.teamId, grant.teamIds));
		selections.push(
			sql`${employee.id} IN (SELECT ${teamMembership.employeeId} FROM ${teamMembership} WHERE ${teamMembership.organizationId} = ${access.organizationId} AND ${inArray(teamMembership.teamId, grant.teamIds)})`,
		);
	}
	return (
		and(
			eq(employee.organizationId, access.organizationId),
			ne(employee.id, access.selfEmployeeId),
			or(...selections) ?? sql`false`,
		) ?? sql`false`
	);
}
export async function listDrivingLicenceVerifierEmployees(
	database: DrivingLicenceDatabase,
	input: { organizationId: string; userId: string; now?: Instant },
) {
	const access = await resolveDrivingLicenceAccess(database, input);
	if (!access) return [];
	return database
		.select({
			id: employee.id,
			canVerify: employeeHasOrganizationAccess(input.now),
		})
		.from(employee)
		.where(drivingLicenceVerifierEmployeeCondition(access))
		.orderBy(employee.id);
}
export async function resolveDrivingLicenceEmployeeAccess(
	database: DrivingLicenceDatabase,
	input: {
		organizationId: string;
		userId: string;
		employeeId: string;
		now?: Instant;
	},
) {
	const access = await resolveDrivingLicenceAccess(database, input);
	if (!access) return { canRead: false, canVerify: false };
	if (access.selfEmployeeId === input.employeeId)
		return { canRead: true, canVerify: false };
	const [target] = await database
		.select({ canVerify: employeeHasOrganizationAccess(input.now) })
		.from(employee)
		.where(
			and(
				eq(employee.id, input.employeeId),
				drivingLicenceVerifierEmployeeCondition(access),
			),
		)
		.limit(1);
	return { canRead: !!target, canVerify: target?.canVerify ?? false };
}
/** Call within the inspection transaction using authenticated server-side identity. Never accepts a client-supplied grant. */
export async function assertDrivingLicenceVerifierAccess(
	database: DrivingLicenceDatabase,
	input: {
		organizationId: string;
		userId: string;
		employeeId: string;
		now?: Instant;
	},
) {
	const access = await resolveDrivingLicenceEmployeeAccess(database, input);
	if (!access.canVerify)
		throw new Error(
			"Current driving licence verifier responsibility is required; self-verification is prohibited",
		);
}
/** Record reads and exports share this boundary, including employee self-reads. */
export async function assertDrivingLicenceRecordAccess(
	database: DrivingLicenceDatabase,
	input: {
		organizationId: string;
		userId: string;
		employeeId: string;
		now?: Instant;
	},
) {
	if (!(await resolveDrivingLicenceEmployeeAccess(database, input)).canRead)
		throw new Error("Driving licence record is unavailable");
}
